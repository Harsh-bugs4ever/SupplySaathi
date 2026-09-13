import { z } from 'zod';
import { config } from '@/lib/config/env';
import { db, fail, handler, ok, parseBody } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';
import { normalizeBrief } from '@/lib/agent/brief';
import { createReasoningProvider } from '@/lib/providers/reasoning';
import { createMemoryProvider } from '@/lib/providers/memory';
import { ParsedBriefSchema, zodValidator } from '@/lib/providers/reasoning/schemas';
import { BRIEF_SYSTEM, briefUserPrompt } from '@/lib/agent/prompts';
import { checkUrl } from '@/lib/security/urlGuard';
import { log } from '@/lib/security/redact';
import type { AppliedMemory } from '@/lib/domain/types';

export const runtime = 'nodejs';

const DimensionsSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.enum(['mm', 'cm', 'in']),
  surface: z.enum(['external', 'internal', 'unspecified']),
});

const CreateCaseSchema = z.object({
  briefText: z.string().min(10, 'Describe what you need in a sentence or two.').max(4000),
  originalProductUrl: z.string().max(600).optional().nullable(),
  mode: z.enum(['demo', 'live']).optional(),
  structured: z
    .object({
      productName: z.string().max(200).nullable().optional(),
      quantity: z.number().int().positive().nullable().optional(),
      partialOk: z.boolean().optional(),
      dimensions: DimensionsSchema.nullable().optional(),
      material: z.array(z.string().max(60)).max(8).optional(),
      certifications: z.array(z.string().max(60)).max(8).optional(),
      foodContactRequired: z.boolean().optional(),
      city: z.string().max(80).nullable().optional(),
      postalCode: z.string().max(20).nullable().optional(),
      country: z.string().max(4).optional(),
      deadlineText: z.string().max(80).nullable().optional(),
      budgetAmount: z.number().positive().nullable().optional(),
      currency: z.string().length(3).optional(),
      budgetScope: z.enum(['merchandise', 'landed']).optional(),
      substitutionsOk: z.boolean().optional(),
      preferences: z.array(z.string().max(120)).max(8).optional(),
      softenedKinds: z.array(z.string().max(40)).max(8).optional(),
    })
    .optional(),
  /** Memory entries the user chose to apply or ignore for this case. */
  acceptedMemoryIds: z.array(z.string().max(80)).max(20).optional(),
});

export const GET = handler(async () => {
  const database = db();
  const cases = repo.listCases(database);

  return ok({
    cases: cases.map((c) => {
      const candidates = repo.listCandidates(c.id, database);
      const drafts = repo.listDrafts(c.id, database);
      return {
        ...c,
        candidateCount: candidates.length,
        qualifyingCount: candidates.filter((x) => x.status !== 'does_not_meet' && x.status !== 'retrieval_failed').length,
        draftCount: drafts.length,
        sentCount: drafts.filter((d) => d.status === 'accepted_by_provider').length,
      };
    }),
  });
});

export const POST = handler(async (req) => {
  const parsed = await parseBody(req, CreateCaseSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const database = db();
  const profile = repo.getOrCreateProfile(database);
  const mode = body.mode ?? config.mode;

  // A user-supplied URL is the first untrusted input in the pipeline, so it is
  // validated here rather than at fetch time.
  let originalUrl: string | null = null;
  if (body.originalProductUrl) {
    const check = checkUrl(body.originalProductUrl);
    if (!check.ok) return fail(`That product URL cannot be used: ${check.reason}`);
    originalUrl = check.normalized!;
  }

  // ── Remembered context ────────────────────────────────────────────────────
  const memory = createMemoryProvider(config, profile.id, database);
  let recalled: AppliedMemory[] = [];
  let memoryUnavailable = false;

  try {
    const items = await memory.recall(body.briefText, 5);
    recalled = items.map((m) => ({
      id: m.id,
      text: m.text,
      kind: m.kind,
      source: m.source,
      // Remembered preferences apply by default but are always visible and
      // switchable, so the user is never surprised by an invisible constraint.
      accepted: body.acceptedMemoryIds ? body.acceptedMemoryIds.includes(m.id) : true,
    }));
    memoryUnavailable = await memory.remoteUnavailable();
  } catch (err) {
    memoryUnavailable = true;
    log.warn('Memory recall failed during case creation', { error: (err as Error).message });
  }

  // ── Parse the brief ───────────────────────────────────────────────────────
  const reasoning = createReasoningProvider(config, mode);
  let parsedBrief;
  let parsedBy = 'rule-based';

  try {
    const result = await reasoning.complete({
      task: 'parse_brief',
      system: BRIEF_SYSTEM,
      user: briefUserPrompt({
        briefText: body.briefText,
        structured: body.structured as Record<string, unknown>,
        memory: recalled.filter((m) => m.accepted).map((m) => m.text),
      }),
      schemaName: 'ParsedBrief',
      validate: zodValidator(ParsedBriefSchema),
      maxTokens: 1500,
    });
    parsedBrief = result.value;
    parsedBy = result.model;
  } catch (err) {
    return fail(
      `Could not read that brief: ${(err as Error).message}. Try describing the requirement more plainly, or fill in the structured fields.`,
      422,
    );
  }

  // ── Normalise into requirements ───────────────────────────────────────────
  const normalized = normalizeBrief({
    parsed: parsedBrief,
    structured: {
      ...body.structured,
      originalProductUrl: originalUrl,
    },
    timezone: profile.timezone,
    defaultCurrency: profile.currency,
  });

  const created = repo.createCase(
    {
      profileId: profile.id,
      title: normalized.title,
      briefText: body.briefText,
      originalProductUrl: originalUrl,
      mode,
      resolvedDeadline: normalized.deadline?.isoDate ?? null,
      deadlineSourcePhrase: normalized.deadline?.sourcePhrase ?? null,
      timezone: profile.timezone,
      currency: body.structured?.currency ?? profile.currency,
      appliedMemory: recalled,
    },
    database,
  );

  for (const r of normalized.requirements) {
    repo.addRequirement({ ...r, caseId: created.id }, database);
  }

  // Only ask questions that would change which products qualify.
  if (normalized.clarifications.length) {
    const questions = normalized.clarifications.map((c, i) => ({
      id: `q${i + 1}`,
      question: c.question,
      reason: c.reason,
      answer: null,
      answeredAt: null,
    }));
    repo.updateCaseFields(created.id, { clarifications: questions }, database);
    repo.setCaseState(created.id, 'NEEDS_CLARIFICATION', database);
  }

  return ok(
    {
      case: repo.getCase(created.id, database),
      requirements: repo.listRequirements(created.id, database),
      deadline: normalized.deadline,
      warnings: normalized.warnings,
      parsedBy,
      memoryUnavailable,
    },
    { status: 201 },
  );
});
