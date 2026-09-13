import { z } from 'zod';
import { db, fail, handler, ok, parseBody, paramOf } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';
import { resolveDeadline } from '@/lib/domain/dates';

export const runtime = 'nodejs';

const AnswerSchema = z.object({
  answers: z
    .array(z.object({ id: z.string().max(40), answer: z.string().min(1).max(500) }))
    .min(1)
    .max(5),
});

/**
 * Answer the outstanding clarifications.
 *
 * Answers are recorded against the exact question asked, so the case history
 * shows what the agent did not know and what the user told it.
 */
export const POST = handler(async (req, ctx) => {
  const id = await paramOf(ctx, 'id');
  const parsed = await parseBody(req, AnswerSchema);
  if (!parsed.ok) return parsed.response;

  const database = db();
  const sourcingCase = repo.getCase(id, database);
  if (!sourcingCase) return fail('Case not found.', 404);

  const now = new Date().toISOString();
  const updated = sourcingCase.clarifications.map((c) => {
    const answer = parsed.data.answers.find((a) => a.id === c.id);
    return answer ? { ...c, answer: answer.answer, answeredAt: now } : c;
  });

  repo.updateCaseFields(sourcingCase.id, { clarifications: updated }, database);

  // An answer may itself contain the deadline we could not resolve earlier.
  if (!sourcingCase.resolvedDeadline) {
    for (const a of parsed.data.answers) {
      const resolved = resolveDeadline(a.answer, sourcingCase.timezone);
      if (resolved) {
        repo.updateCaseFields(
          sourcingCase.id,
          { resolvedDeadline: resolved.isoDate, deadlineSourcePhrase: resolved.sourcePhrase },
          database,
        );
        repo.addRequirement(
          {
            caseId: sourcingCase.id,
            kind: 'delivery_date',
            priority: 'must_have',
            label: `Arrive by ${resolved.display}`,
            spec: { kind: 'delivery_date', isoDate: resolved.isoDate, timezone: sourcingCase.timezone },
          },
          database,
        );
        break;
      }
    }
  }

  const remaining = updated.filter((c) => !c.answer);
  if (!remaining.length) repo.setCaseState(sourcingCase.id, 'DRAFT', database);

  return ok({
    case: repo.getCase(sourcingCase.id, database),
    requirements: repo.listRequirements(sourcingCase.id, database),
    remaining: remaining.length,
  });
});
