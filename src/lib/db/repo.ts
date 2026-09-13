import type { Db } from './sqlite';
import { getDb } from './client';
import { draftContentHash, newCaseReference, newId, nowIso } from './ids';
import type {
  AppliedMemory,
  BusinessProfile,
  CandidateProduct,
  CaseState,
  ClarificationQuestion,
  ConstraintEvaluation,
  EmailAttempt,
  Evidence,
  OutreachApproval,
  QuoteDraft,
  Requirement,
  ResearchEvent,
  ResearchEventKind,
  ResearchRun,
  RunStatus,
  SourcingCase,
  SupplierNote,
} from '../domain/types';

/**
 * Typed data access.
 *
 * Row mapping is explicit rather than generated so the JSON value-object
 * columns decode into real domain types at exactly one place, and a schema
 * change produces a TypeScript error rather than an `undefined` at runtime.
 */

type Row = Record<string, any>;

const J = {
  parse<T>(s: string | null, fallback: T): T {
    if (!s) return fallback;
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  },
  str(v: unknown): string {
    return JSON.stringify(v ?? null);
  },
};

// ── Business profile ────────────────────────────────────────────────────────

export function getOrCreateProfile(db: Db = getDb()): BusinessProfile {
  const existing = db.prepare('SELECT * FROM business_profile LIMIT 1').get() as Row | undefined;
  if (existing) return mapProfile(existing);

  const ts = nowIso();
  const profile: BusinessProfile = {
    id: newId('biz'),
    businessName: 'My Bakery',
    city: 'Pune',
    postalCode: '411001',
    country: 'IN',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    contactEmail: '',
    createdAt: ts,
    updatedAt: ts,
  };
  db.prepare(
    `INSERT INTO business_profile
       (id, business_name, city, postal_code, country, currency, timezone, contact_email, created_at, updated_at)
     VALUES (@id, @businessName, @city, @postalCode, @country, @currency, @timezone, @contactEmail, @createdAt, @updatedAt)`,
  ).run(profile);
  return profile;
}

export function updateProfile(
  patch: Partial<BusinessProfile> & { id: string },
  db: Db = getDb(),
): BusinessProfile {
  const current = db.prepare('SELECT * FROM business_profile WHERE id = ?').get(patch.id) as Row;
  if (!current) throw new Error('Business profile not found');
  const merged = { ...mapProfile(current), ...patch, updatedAt: nowIso() };
  db.prepare(
    `UPDATE business_profile SET
       business_name=@businessName, city=@city, postal_code=@postalCode, country=@country,
       currency=@currency, timezone=@timezone, contact_email=@contactEmail, updated_at=@updatedAt
     WHERE id=@id`,
  ).run(merged);
  return merged;
}

function mapProfile(r: Row): BusinessProfile {
  return {
    id: r.id,
    businessName: r.business_name,
    city: r.city,
    postalCode: r.postal_code,
    country: r.country,
    currency: r.currency,
    timezone: r.timezone,
    contactEmail: r.contact_email,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Sourcing case ───────────────────────────────────────────────────────────

export interface CreateCaseInput {
  profileId: string;
  title: string;
  briefText: string;
  originalProductUrl: string | null;
  mode: 'demo' | 'live';
  resolvedDeadline: string | null;
  deadlineSourcePhrase: string | null;
  timezone: string;
  currency: string;
  appliedMemory?: AppliedMemory[];
}

export function createCase(input: CreateCaseInput, db: Db = getDb()): SourcingCase {
  const ts = nowIso();
  const c: SourcingCase = {
    id: newId('case'),
    reference: newCaseReference(),
    profileId: input.profileId,
    title: input.title,
    briefText: input.briefText,
    originalProductUrl: input.originalProductUrl,
    state: 'DRAFT',
    mode: input.mode,
    resolvedDeadline: input.resolvedDeadline,
    deadlineSourcePhrase: input.deadlineSourcePhrase,
    timezone: input.timezone,
    currency: input.currency,
    clarifications: [],
    appliedMemory: input.appliedMemory ?? [],
    createdAt: ts,
    updatedAt: ts,
  };

  db.prepare(
    `INSERT INTO sourcing_case
       (id, reference, profile_id, title, brief_text, original_product_url, state, mode,
        resolved_deadline, deadline_source_phrase, timezone, currency,
        clarifications_json, applied_memory_json, created_at, updated_at)
     VALUES (@id, @reference, @profileId, @title, @briefText, @originalProductUrl, @state, @mode,
             @resolvedDeadline, @deadlineSourcePhrase, @timezone, @currency,
             @clarifications, @appliedMemory, @createdAt, @updatedAt)`,
  ).run({
    ...c,
    clarifications: J.str(c.clarifications),
    appliedMemory: J.str(c.appliedMemory),
  });

  return c;
}

export function getCase(id: string, db: Db = getDb()): SourcingCase | null {
  const r = db.prepare('SELECT * FROM sourcing_case WHERE id = ? OR reference = ?').get(id, id) as
    | Row
    | undefined;
  return r ? mapCase(r) : null;
}

export function listCases(db: Db = getDb()): SourcingCase[] {
  return (db.prepare('SELECT * FROM sourcing_case ORDER BY created_at DESC').all() as Row[]).map(
    mapCase,
  );
}

export function setCaseState(
  caseId: string,
  state: CaseState,
  db: Db = getDb(),
): void {
  db.prepare('UPDATE sourcing_case SET state = ?, updated_at = ? WHERE id = ?').run(
    state,
    nowIso(),
    caseId,
  );
}

export function updateCaseFields(
  caseId: string,
  patch: Partial<
    Pick<
      SourcingCase,
      'title' | 'briefText' | 'resolvedDeadline' | 'deadlineSourcePhrase' | 'clarifications' | 'appliedMemory'
    >
  >,
  db: Db = getDb(),
): void {
  const sets: string[] = [];
  const params: Row = { caseId, updatedAt: nowIso() };

  if (patch.title !== undefined) (sets.push('title=@title'), (params.title = patch.title));
  if (patch.briefText !== undefined) (sets.push('brief_text=@briefText'), (params.briefText = patch.briefText));
  if (patch.resolvedDeadline !== undefined) {
    sets.push('resolved_deadline=@resolvedDeadline');
    params.resolvedDeadline = patch.resolvedDeadline;
  }
  if (patch.deadlineSourcePhrase !== undefined) {
    sets.push('deadline_source_phrase=@deadlineSourcePhrase');
    params.deadlineSourcePhrase = patch.deadlineSourcePhrase;
  }
  if (patch.clarifications !== undefined) {
    sets.push('clarifications_json=@clarifications');
    params.clarifications = J.str(patch.clarifications);
  }
  if (patch.appliedMemory !== undefined) {
    sets.push('applied_memory_json=@appliedMemory');
    params.appliedMemory = J.str(patch.appliedMemory);
  }
  if (!sets.length) return;

  db.prepare(`UPDATE sourcing_case SET ${sets.join(', ')}, updated_at=@updatedAt WHERE id=@caseId`).run(
    params,
  );
}

function mapCase(r: Row): SourcingCase {
  return {
    id: r.id,
    reference: r.reference,
    profileId: r.profile_id,
    title: r.title,
    briefText: r.brief_text,
    originalProductUrl: r.original_product_url,
    state: r.state as CaseState,
    mode: r.mode,
    resolvedDeadline: r.resolved_deadline,
    deadlineSourcePhrase: r.deadline_source_phrase,
    timezone: r.timezone,
    currency: r.currency,
    clarifications: J.parse<ClarificationQuestion[]>(r.clarifications_json, []),
    appliedMemory: J.parse<AppliedMemory[]>(r.applied_memory_json, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Requirements ────────────────────────────────────────────────────────────

export function addRequirement(
  req: Omit<Requirement, 'id' | 'createdAt'>,
  db: Db = getDb(),
): Requirement {
  const full: Requirement = { ...req, id: newId('req'), createdAt: nowIso() };
  db.prepare(
    `INSERT INTO requirement (id, case_id, kind, priority, label, spec_json, created_at)
     VALUES (@id, @caseId, @kind, @priority, @label, @spec, @createdAt)`,
  ).run({ ...full, spec: J.str(full.spec) });
  return full;
}

export function listRequirements(caseId: string, db: Db = getDb()): Requirement[] {
  return (
    db.prepare('SELECT * FROM requirement WHERE case_id = ? ORDER BY created_at').all(caseId) as Row[]
  ).map((r) => ({
    id: r.id,
    caseId: r.case_id,
    kind: r.kind,
    priority: r.priority,
    label: r.label,
    spec: J.parse(r.spec_json, { kind: 'other', text: r.label } as any),
    createdAt: r.created_at,
  }));
}

export function clearRequirements(caseId: string, db: Db = getDb()): void {
  db.prepare('DELETE FROM requirement WHERE case_id = ?').run(caseId);
}

// ── Research runs and events ────────────────────────────────────────────────

export function createRun(
  caseId: string,
  mode: 'demo' | 'live',
  round: number,
  db: Db = getDb(),
): ResearchRun {
  const run: ResearchRun = {
    id: newId('run'),
    caseId,
    status: 'queued',
    mode,
    round,
    pagesFetched: 0,
    pagesFailed: 0,
    startedAt: null,
    finishedAt: null,
    cancelRequested: false,
    error: null,
    createdAt: nowIso(),
  };
  db.prepare(
    `INSERT INTO research_run (id, case_id, status, mode, round, pages_fetched, pages_failed, cancel_requested, created_at)
     VALUES (@id, @caseId, @status, @mode, @round, 0, 0, 0, @createdAt)`,
  ).run(run);
  return run;
}

export function getRun(runId: string, db: Db = getDb()): ResearchRun | null {
  const r = db.prepare('SELECT * FROM research_run WHERE id = ?').get(runId) as Row | undefined;
  return r ? mapRun(r) : null;
}

export function latestRun(caseId: string, db: Db = getDb()): ResearchRun | null {
  const r = db
    .prepare('SELECT * FROM research_run WHERE case_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(caseId) as Row | undefined;
  return r ? mapRun(r) : null;
}

export function updateRun(
  runId: string,
  patch: Partial<Pick<ResearchRun, 'status' | 'pagesFetched' | 'pagesFailed' | 'startedAt' | 'finishedAt' | 'error'>>,
  db: Db = getDb(),
): void {
  const map: Record<string, string> = {
    status: 'status',
    pagesFetched: 'pages_fetched',
    pagesFailed: 'pages_failed',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
    error: 'error',
  };
  const sets: string[] = [];
  const params: Row = { runId };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${map[k]} = @${k}`);
    params[k] = v;
  }
  if (!sets.length) return;
  db.prepare(`UPDATE research_run SET ${sets.join(', ')} WHERE id = @runId`).run(params);
}

export function requestCancel(runId: string, db: Db = getDb()): void {
  db.prepare('UPDATE research_run SET cancel_requested = 1 WHERE id = ?').run(runId);
}

/**
 * Read the cancel flag straight from the database rather than from memory.
 * Cancellation is issued by the web process and observed by the worker, so the
 * database is the only place both can see it.
 */
export function isCancelRequested(runId: string, db: Db = getDb()): boolean {
  const r = db.prepare('SELECT cancel_requested FROM research_run WHERE id = ?').get(runId) as
    | Row
    | undefined;
  return Boolean(r?.cancel_requested);
}

function mapRun(r: Row): ResearchRun {
  return {
    id: r.id,
    caseId: r.case_id,
    status: r.status as RunStatus,
    mode: r.mode,
    round: r.round,
    pagesFetched: r.pages_fetched,
    pagesFailed: r.pages_failed,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    cancelRequested: Boolean(r.cancel_requested),
    error: r.error,
    createdAt: r.created_at,
  };
}

export function appendEvent(
  input: {
    caseId: string;
    runId: string;
    kind: ResearchEventKind;
    message: string;
    detail?: string | null;
    candidateId?: string | null;
  },
  db: Db = getDb(),
): ResearchEvent {
  // Sequence is allocated inside the insert so two writers cannot collide on
  // the unique (run_id, seq) index.
  const insert = db.transaction(() => {
    const max = db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM research_event WHERE run_id = ?')
      .get(input.runId) as Row;
    const seq = (max?.m ?? 0) + 1;
    const ev: ResearchEvent = {
      id: newId('ev'),
      caseId: input.caseId,
      runId: input.runId,
      seq,
      kind: input.kind,
      message: input.message,
      detail: input.detail ?? null,
      candidateId: input.candidateId ?? null,
      createdAt: nowIso(),
    };
    db.prepare(
      `INSERT INTO research_event (id, case_id, run_id, seq, kind, message, detail, candidate_id, created_at)
       VALUES (@id, @caseId, @runId, @seq, @kind, @message, @detail, @candidateId, @createdAt)`,
    ).run(ev);
    return ev;
  });
  return insert();
}

export function listEvents(
  caseId: string,
  afterSeq = 0,
  runId?: string,
  db: Db = getDb(),
): ResearchEvent[] {
  const rows = runId
    ? (db
        .prepare('SELECT * FROM research_event WHERE run_id = ? AND seq > ? ORDER BY seq')
        .all(runId, afterSeq) as Row[])
    : (db
        .prepare('SELECT * FROM research_event WHERE case_id = ? ORDER BY created_at, seq')
        .all(caseId) as Row[]);

  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    runId: r.run_id,
    seq: r.seq,
    kind: r.kind as ResearchEventKind,
    message: r.message,
    detail: r.detail,
    candidateId: r.candidate_id,
    createdAt: r.created_at,
  }));
}

// ── Candidates ──────────────────────────────────────────────────────────────

export function upsertCandidate(
  c: Omit<CandidateProduct, 'id' | 'createdAt'> & { id?: string },
  db: Db = getDb(),
): CandidateProduct {
  const existing = db
    .prepare('SELECT id FROM candidate_product WHERE case_id = ? AND dedupe_key = ?')
    .get(c.caseId, c.dedupeKey) as Row | undefined;

  const full: CandidateProduct = {
    ...c,
    id: existing?.id ?? c.id ?? newId('cand'),
    createdAt: nowIso(),
  };

  const params = {
    ...full,
    pricePerPack: J.str(full.pricePerPack),
    dimensions: J.str(full.dimensions),
    costing: J.str(full.costing),
  };

  if (existing) {
    db.prepare(
      `UPDATE candidate_product SET
         run_id=@runId, supplier_name=@supplierName, product_title=@productTitle, source_url=@sourceUrl,
         image_url=@imageUrl, retrieved_at=@retrievedAt, status=@status, units_per_pack=@unitsPerPack,
         price_per_pack_json=@pricePerPack, min_order_packs=@minOrderPacks,
         order_increment_packs=@orderIncrementPacks, dimensions_json=@dimensions, material=@material,
         food_contact_claim=@foodContactClaim, shipping_info=@shippingInfo, lead_time_info=@leadTimeInfo,
         currency=@currency, costing_json=@costing, rationale=@rationale, rank_score=@rankScore
       WHERE id=@id`,
    ).run(params);
  } else {
    db.prepare(
      `INSERT INTO candidate_product
         (id, case_id, run_id, supplier_name, product_title, source_url, image_url, retrieved_at, status,
          units_per_pack, price_per_pack_json, min_order_packs, order_increment_packs, dimensions_json,
          material, food_contact_claim, shipping_info, lead_time_info, currency, costing_json,
          rationale, rank_score, dedupe_key, created_at)
       VALUES (@id, @caseId, @runId, @supplierName, @productTitle, @sourceUrl, @imageUrl, @retrievedAt, @status,
               @unitsPerPack, @pricePerPack, @minOrderPacks, @orderIncrementPacks, @dimensions,
               @material, @foodContactClaim, @shippingInfo, @leadTimeInfo, @currency, @costing,
               @rationale, @rankScore, @dedupeKey, @createdAt)`,
    ).run(params);
  }

  return full;
}

export function listCandidates(caseId: string, db: Db = getDb()): CandidateProduct[] {
  return (
    db
      .prepare('SELECT * FROM candidate_product WHERE case_id = ? ORDER BY rank_score DESC, created_at')
      .all(caseId) as Row[]
  ).map(mapCandidate);
}

export function getCandidate(id: string, db: Db = getDb()): CandidateProduct | null {
  const r = db.prepare('SELECT * FROM candidate_product WHERE id = ?').get(id) as Row | undefined;
  return r ? mapCandidate(r) : null;
}

function mapCandidate(r: Row): CandidateProduct {
  return {
    id: r.id,
    caseId: r.case_id,
    runId: r.run_id,
    supplierName: r.supplier_name,
    productTitle: r.product_title,
    sourceUrl: r.source_url,
    imageUrl: r.image_url,
    retrievedAt: r.retrieved_at,
    status: r.status,
    unitsPerPack: r.units_per_pack,
    pricePerPack: J.parse(r.price_per_pack_json, null),
    minOrderPacks: r.min_order_packs,
    orderIncrementPacks: r.order_increment_packs,
    dimensions: J.parse(r.dimensions_json, null),
    material: r.material,
    foodContactClaim: r.food_contact_claim,
    shippingInfo: r.shipping_info,
    leadTimeInfo: r.lead_time_info,
    currency: r.currency,
    costing: J.parse(r.costing_json, null),
    rationale: r.rationale,
    rankScore: r.rank_score,
    dedupeKey: r.dedupe_key,
    createdAt: r.created_at,
  };
}

// ── Evidence ────────────────────────────────────────────────────────────────

export function addEvidence(
  e: Omit<Evidence, 'id' | 'createdAt'>,
  db: Db = getDb(),
): Evidence {
  const full: Evidence = { ...e, id: newId('ev'), createdAt: nowIso() };
  db.prepare(
    `INSERT INTO evidence (id, case_id, candidate_id, fact_path, status, authority, source_url, excerpt, interpretation, retrieved_at, created_at)
     VALUES (@id, @caseId, @candidateId, @factPath, @status, @authority, @sourceUrl, @excerpt, @interpretation, @retrievedAt, @createdAt)`,
  ).run(full);
  return full;
}

export function listEvidence(
  caseId: string,
  candidateId?: string,
  db: Db = getDb(),
): Evidence[] {
  const rows = candidateId
    ? (db.prepare('SELECT * FROM evidence WHERE candidate_id = ? ORDER BY created_at').all(candidateId) as Row[])
    : (db.prepare('SELECT * FROM evidence WHERE case_id = ? ORDER BY created_at').all(caseId) as Row[]);
  return rows.map((r) => ({
    id: r.id,
    caseId: r.case_id,
    candidateId: r.candidate_id,
    factPath: r.fact_path,
    status: r.status,
    authority: r.authority,
    sourceUrl: r.source_url,
    excerpt: r.excerpt,
    interpretation: r.interpretation,
    retrievedAt: r.retrieved_at,
    createdAt: r.created_at,
  }));
}

export function clearCandidateData(caseId: string, db: Db = getDb()): void {
  db.prepare('DELETE FROM constraint_evaluation WHERE case_id = ?').run(caseId);
  db.prepare('DELETE FROM evidence WHERE case_id = ?').run(caseId);
  db.prepare('DELETE FROM candidate_product WHERE case_id = ?').run(caseId);
}

// ── Constraint evaluations ──────────────────────────────────────────────────

export function addEvaluation(
  e: Omit<ConstraintEvaluation, 'id' | 'createdAt'>,
  db: Db = getDb(),
): ConstraintEvaluation {
  const full: ConstraintEvaluation = { ...e, id: newId('ce'), createdAt: nowIso() };
  db.prepare(
    `INSERT INTO constraint_evaluation
       (id, case_id, candidate_id, requirement_id, requirement_label, priority, outcome, explanation, evidence_ids_json, created_at)
     VALUES (@id, @caseId, @candidateId, @requirementId, @requirementLabel, @priority, @outcome, @explanation, @evidenceIds, @createdAt)`,
  ).run({ ...full, evidenceIds: J.str(full.evidenceIds) });
  return full;
}

export function listEvaluations(
  caseId: string,
  db: Db = getDb(),
): ConstraintEvaluation[] {
  return (
    db.prepare('SELECT * FROM constraint_evaluation WHERE case_id = ? ORDER BY created_at').all(caseId) as Row[]
  ).map((r) => ({
    id: r.id,
    caseId: r.case_id,
    candidateId: r.candidate_id,
    requirementId: r.requirement_id,
    requirementLabel: r.requirement_label,
    priority: r.priority,
    outcome: r.outcome,
    explanation: r.explanation,
    evidenceIds: J.parse<string[]>(r.evidence_ids_json, []),
    createdAt: r.created_at,
  }));
}

// ── Quote drafts ────────────────────────────────────────────────────────────

export function createDraft(
  d: Omit<QuoteDraft, 'id' | 'version' | 'contentHash' | 'createdAt' | 'updatedAt'>,
  db: Db = getDb(),
): QuoteDraft {
  const ts = nowIso();
  const full: QuoteDraft = {
    ...d,
    id: newId('draft'),
    version: 1,
    contentHash: draftContentHash(d),
    createdAt: ts,
    updatedAt: ts,
  };
  db.prepare(
    `INSERT INTO quote_draft
       (id, case_id, candidate_id, supplier_name, recipient_email, recipient_source, recipient_source_url,
        subject, body, version, content_hash, status, questions_json, created_at, updated_at)
     VALUES (@id, @caseId, @candidateId, @supplierName, @recipientEmail, @recipientSource, @recipientSourceUrl,
             @subject, @body, @version, @contentHash, @status, @questions, @createdAt, @updatedAt)`,
  ).run({ ...full, questions: J.str(full.questions) });
  return full;
}

/**
 * Edit a draft.
 *
 * Any change to recipient, subject or body bumps the version and recomputes the
 * hash, and every live approval for this draft is invalidated in the same
 * transaction. There is no window in which an old approval authorises new text.
 */
export function updateDraft(
  draftId: string,
  patch: Partial<Pick<QuoteDraft, 'recipientEmail' | 'recipientSource' | 'subject' | 'body'>>,
  db: Db = getDb(),
): QuoteDraft {
  const tx = db.transaction(() => {
    const current = getDraft(draftId, db);
    if (!current) throw new Error('Draft not found');

    const next = {
      recipientEmail: patch.recipientEmail !== undefined ? patch.recipientEmail : current.recipientEmail,
      subject: patch.subject ?? current.subject,
      body: patch.body ?? current.body,
    };
    const newHash = draftContentHash(next);

    if (newHash === current.contentHash) return current;

    const changed: string[] = [];
    if (next.recipientEmail !== current.recipientEmail) changed.push('recipient');
    if (next.subject !== current.subject) changed.push('subject');
    if (next.body !== current.body) changed.push('body');

    db.prepare(
      `UPDATE outreach_approval
         SET invalidated_at = ?, invalidation_reason = ?
       WHERE draft_id = ? AND invalidated_at IS NULL`,
    ).run(nowIso(), `The ${changed.join(' and ')} changed after approval.`, draftId);

    const updated: QuoteDraft = {
      ...current,
      ...next,
      recipientSource: patch.recipientSource ?? current.recipientSource,
      version: current.version + 1,
      contentHash: newHash,
      // Editing returns the draft to an unapproved state, always.
      status: 'draft',
      updatedAt: nowIso(),
    };

    db.prepare(
      `UPDATE quote_draft SET
         recipient_email=@recipientEmail, recipient_source=@recipientSource, subject=@subject,
         body=@body, version=@version, content_hash=@contentHash, status=@status, updated_at=@updatedAt
       WHERE id=@id`,
    ).run(updated);

    return updated;
  });
  return tx();
}

export function setDraftStatus(
  draftId: string,
  status: QuoteDraft['status'],
  db: Db = getDb(),
): void {
  db.prepare('UPDATE quote_draft SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    nowIso(),
    draftId,
  );
}

export function getDraft(id: string, db: Db = getDb()): QuoteDraft | null {
  const r = db.prepare('SELECT * FROM quote_draft WHERE id = ?').get(id) as Row | undefined;
  return r ? mapDraft(r) : null;
}

export function listDrafts(caseId: string, db: Db = getDb()): QuoteDraft[] {
  return (
    db.prepare('SELECT * FROM quote_draft WHERE case_id = ? ORDER BY created_at').all(caseId) as Row[]
  ).map(mapDraft);
}

export function deleteDraftsForCase(caseId: string, db: Db = getDb()): void {
  db.prepare('DELETE FROM quote_draft WHERE case_id = ?').run(caseId);
}

function mapDraft(r: Row): QuoteDraft {
  return {
    id: r.id,
    caseId: r.case_id,
    candidateId: r.candidate_id,
    supplierName: r.supplier_name,
    recipientEmail: r.recipient_email,
    recipientSource: r.recipient_source,
    recipientSourceUrl: r.recipient_source_url,
    subject: r.subject,
    body: r.body,
    version: r.version,
    contentHash: r.content_hash,
    status: r.status,
    questions: J.parse<string[]>(r.questions_json, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Approvals ───────────────────────────────────────────────────────────────

export function approveDraft(
  draftId: string,
  db: Db = getDb(),
): { approval: OutreachApproval; draft: QuoteDraft } {
  const tx = db.transaction(() => {
    const draft = getDraft(draftId, db);
    if (!draft) throw new Error('Draft not found');
    if (!draft.recipientEmail) {
      throw new Error('Cannot approve a draft with no recipient address.');
    }

    // Supersede any earlier approval so exactly one can ever be live.
    db.prepare(
      `UPDATE outreach_approval SET invalidated_at = ?, invalidation_reason = ?
       WHERE draft_id = ? AND invalidated_at IS NULL`,
    ).run(nowIso(), 'Superseded by a newer approval.', draftId);

    const approval: OutreachApproval = {
      id: newId('appr'),
      caseId: draft.caseId,
      draftId: draft.id,
      draftVersion: draft.version,
      contentHash: draft.contentHash,
      recipientEmail: draft.recipientEmail,
      approvedAt: nowIso(),
      invalidatedAt: null,
      invalidationReason: null,
    };
    db.prepare(
      `INSERT INTO outreach_approval (id, case_id, draft_id, draft_version, content_hash, recipient_email, approved_at)
       VALUES (@id, @caseId, @draftId, @draftVersion, @contentHash, @recipientEmail, @approvedAt)`,
    ).run(approval);

    setDraftStatus(draft.id, 'approved', db);
    return { approval, draft: { ...draft, status: 'approved' as const } };
  });
  return tx();
}

export function getLiveApproval(
  draftId: string,
  db: Db = getDb(),
): OutreachApproval | null {
  const r = db
    .prepare(
      'SELECT * FROM outreach_approval WHERE draft_id = ? AND invalidated_at IS NULL ORDER BY approved_at DESC LIMIT 1',
    )
    .get(draftId) as Row | undefined;
  return r ? mapApproval(r) : null;
}

export function listApprovals(caseId: string, db: Db = getDb()): OutreachApproval[] {
  return (
    db.prepare('SELECT * FROM outreach_approval WHERE case_id = ? ORDER BY approved_at DESC').all(caseId) as Row[]
  ).map(mapApproval);
}

function mapApproval(r: Row): OutreachApproval {
  return {
    id: r.id,
    caseId: r.case_id,
    draftId: r.draft_id,
    draftVersion: r.draft_version,
    contentHash: r.content_hash,
    recipientEmail: r.recipient_email,
    approvedAt: r.approved_at,
    invalidatedAt: r.invalidated_at,
    invalidationReason: r.invalidation_reason,
  };
}

// ── Email attempts ──────────────────────────────────────────────────────────

/**
 * Claim the right to send.
 *
 * Returns the existing attempt when this idempotency key has been used before,
 * so the caller can report the previous outcome instead of sending again. The
 * unique index does the real work; this just makes the race explicit.
 */
export function claimSendAttempt(
  input: {
    caseId: string;
    draftId: string;
    approvalId: string;
    idempotencyKey: string;
    providerKind: string;
  },
  db: Db = getDb(),
): { attempt: EmailAttempt; alreadyExisted: boolean } {
  const existing = db
    .prepare('SELECT * FROM email_attempt WHERE idempotency_key = ?')
    .get(input.idempotencyKey) as Row | undefined;
  if (existing) return { attempt: mapAttempt(existing), alreadyExisted: true };

  const attempt: EmailAttempt = {
    id: newId('att'),
    caseId: input.caseId,
    draftId: input.draftId,
    approvalId: input.approvalId,
    idempotencyKey: input.idempotencyKey,
    status: 'sending',
    providerKind: input.providerKind,
    providerMessageId: null,
    providerResponse: null,
    error: null,
    createdAt: nowIso(),
    completedAt: null,
  };

  try {
    db.prepare(
      `INSERT INTO email_attempt (id, case_id, draft_id, approval_id, idempotency_key, status, provider_kind, created_at)
       VALUES (@id, @caseId, @draftId, @approvalId, @idempotencyKey, @status, @providerKind, @createdAt)`,
    ).run(attempt);
    return { attempt, alreadyExisted: false };
  } catch (err) {
    // Lost the race to a concurrent request; that request owns the send.
    const raced = db
      .prepare('SELECT * FROM email_attempt WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as Row | undefined;
    if (raced) return { attempt: mapAttempt(raced), alreadyExisted: true };
    throw err;
  }
}

export function completeSendAttempt(
  attemptId: string,
  patch: Pick<EmailAttempt, 'status'> &
    Partial<Pick<EmailAttempt, 'providerMessageId' | 'providerResponse' | 'error'>>,
  db: Db = getDb(),
): void {
  db.prepare(
    `UPDATE email_attempt SET status=@status, provider_message_id=@providerMessageId,
       provider_response=@providerResponse, error=@error, completed_at=@completedAt WHERE id=@id`,
  ).run({
    id: attemptId,
    status: patch.status,
    providerMessageId: patch.providerMessageId ?? null,
    providerResponse: patch.providerResponse ?? null,
    error: patch.error ?? null,
    completedAt: nowIso(),
  });
}

export function listAttempts(caseId: string, db: Db = getDb()): EmailAttempt[] {
  return (
    db.prepare('SELECT * FROM email_attempt WHERE case_id = ? ORDER BY created_at DESC').all(caseId) as Row[]
  ).map(mapAttempt);
}

function mapAttempt(r: Row): EmailAttempt {
  return {
    id: r.id,
    caseId: r.case_id,
    draftId: r.draft_id,
    approvalId: r.approval_id,
    idempotencyKey: r.idempotency_key,
    status: r.status,
    providerKind: r.provider_kind,
    providerMessageId: r.provider_message_id,
    providerResponse: r.provider_response,
    error: r.error,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

// ── Supplier notes / local memory mirror ────────────────────────────────────

export function addNote(
  n: Omit<SupplierNote, 'id' | 'createdAt'>,
  db: Db = getDb(),
): SupplierNote {
  const full: SupplierNote = { ...n, id: newId('note'), createdAt: nowIso() };
  db.prepare(
    `INSERT INTO supplier_note (id, profile_id, kind, supplier_name, text, case_id, synced_to_memory, created_at)
     VALUES (@id, @profileId, @kind, @supplierName, @text, @caseId, @synced, @createdAt)`,
  ).run({ ...full, synced: full.syncedToMemory ? 1 : 0 });
  return full;
}

export function listNotes(profileId: string, db: Db = getDb()): SupplierNote[] {
  return (
    db.prepare('SELECT * FROM supplier_note WHERE profile_id = ? ORDER BY created_at DESC').all(profileId) as Row[]
  ).map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    kind: r.kind,
    supplierName: r.supplier_name,
    text: r.text,
    caseId: r.case_id,
    syncedToMemory: Boolean(r.synced_to_memory),
    createdAt: r.created_at,
  }));
}

export function deleteNote(id: string, db: Db = getDb()): void {
  db.prepare('DELETE FROM supplier_note WHERE id = ?').run(id);
}

export function markNoteSynced(id: string, db: Db = getDb()): void {
  db.prepare('UPDATE supplier_note SET synced_to_memory = 1 WHERE id = ?').run(id);
}

// ── Job queue ───────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  kind: string;
  caseId: string;
  runId: string | null;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  lastError: string | null;
}

export function enqueueJob(
  input: { kind: string; caseId: string; runId?: string | null; payload?: Record<string, unknown> },
  db: Db = getDb(),
): Job {
  const ts = nowIso();
  const job: Job = {
    id: newId('job'),
    kind: input.kind,
    caseId: input.caseId,
    runId: input.runId ?? null,
    payload: input.payload ?? {},
    status: 'queued',
    attempts: 0,
    lastError: null,
  };
  db.prepare(
    `INSERT INTO job (id, kind, case_id, run_id, payload_json, status, attempts, created_at, updated_at)
     VALUES (@id, @kind, @caseId, @runId, @payload, 'queued', 0, @ts, @ts)`,
  ).run({ ...job, payload: J.str(job.payload), ts });
  return job;
}

/**
 * Atomically take the oldest queued job.
 *
 * `UPDATE ... WHERE status='queued'` inside a transaction is what stops two
 * workers from running the same research twice.
 */
export function claimNextJob(workerId: string, db: Db = getDb()): Job | null {
  const tx = db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM job WHERE status = 'queued' ORDER BY created_at LIMIT 1")
      .get() as Row | undefined;
    if (!row) return null;

    const res = db
      .prepare(
        "UPDATE job SET status='running', locked_at=?, locked_by=?, attempts=attempts+1, updated_at=? WHERE id=? AND status='queued'",
      )
      .run(nowIso(), workerId, nowIso(), row.id);
    if (res.changes === 0) return null;

    return {
      id: row.id,
      kind: row.kind,
      caseId: row.case_id,
      runId: row.run_id,
      payload: J.parse<Record<string, unknown>>(row.payload_json, {}),
      status: 'running' as const,
      attempts: row.attempts + 1,
      lastError: row.last_error,
    };
  });
  return tx();
}

export function finishJob(
  id: string,
  status: 'done' | 'failed',
  error?: string,
  db: Db = getDb(),
): void {
  db.prepare('UPDATE job SET status=?, last_error=?, updated_at=? WHERE id=?').run(
    status,
    error ?? null,
    nowIso(),
    id,
  );
}

/**
 * Recover jobs abandoned by a worker that died mid-run.
 *
 * Without this, killing the worker would leave a case stuck in RESEARCHING for
 * ever. Anything still `running` at startup is put back on the queue.
 */
export function reclaimStaleJobs(db: Db = getDb()): number {
  const res = db
    .prepare("UPDATE job SET status='queued', locked_at=NULL, locked_by=NULL, updated_at=? WHERE status='running'")
    .run(nowIso());
  return res.changes;
}
