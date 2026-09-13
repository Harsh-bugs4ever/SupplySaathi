-- SupplySaathi initial schema.
--
-- Design notes:
--  * This database is the transactional source of truth. Case state, quantities,
--    deadlines, approvals and email-send records live here and nowhere else.
--    Cognee holds contextual memory only.
--  * JSON columns hold value objects (specs, costing, money) that are always
--    read and written as a unit and never queried field-by-field.
--  * Every table carries a stable text id so events can be correlated across
--    processes and across restarts.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS business_profile (
  id            TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  city          TEXT NOT NULL DEFAULT '',
  postal_code   TEXT NOT NULL DEFAULT '',
  country       TEXT NOT NULL DEFAULT 'IN',
  currency      TEXT NOT NULL DEFAULT 'INR',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  contact_email TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sourcing_case (
  id                     TEXT PRIMARY KEY,
  reference              TEXT NOT NULL UNIQUE,
  profile_id             TEXT NOT NULL REFERENCES business_profile(id) ON DELETE CASCADE,
  title                  TEXT NOT NULL,
  brief_text             TEXT NOT NULL,
  original_product_url   TEXT,
  state                  TEXT NOT NULL,
  mode                   TEXT NOT NULL CHECK (mode IN ('demo','live')),
  resolved_deadline      TEXT,
  deadline_source_phrase TEXT,
  timezone               TEXT NOT NULL,
  currency               TEXT NOT NULL,
  clarifications_json    TEXT NOT NULL DEFAULT '[]',
  applied_memory_json    TEXT NOT NULL DEFAULT '[]',
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_profile ON sourcing_case(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS requirement (
  id         TEXT PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES sourcing_case(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  priority   TEXT NOT NULL CHECK (priority IN ('must_have','preference')),
  label      TEXT NOT NULL,
  spec_json  TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requirement_case ON requirement(case_id);

CREATE TABLE IF NOT EXISTS research_run (
  id               TEXT PRIMARY KEY,
  case_id          TEXT NOT NULL REFERENCES sourcing_case(id) ON DELETE CASCADE,
  status           TEXT NOT NULL,
  mode             TEXT NOT NULL,
  round            INTEGER NOT NULL DEFAULT 1,
  pages_fetched    INTEGER NOT NULL DEFAULT 0,
  pages_failed     INTEGER NOT NULL DEFAULT 0,
  started_at       TEXT,
  finished_at      TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_case ON research_run(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_status ON research_run(status);

CREATE TABLE IF NOT EXISTS research_event (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES sourcing_case(id) ON DELETE CASCADE,
  run_id       TEXT NOT NULL REFERENCES research_run(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  message      TEXT NOT NULL,
  detail       TEXT,
  candidate_id TEXT,
  created_at   TEXT NOT NULL
);
-- The SSE endpoint pages through events by (run, seq), so this index is on the
-- hot path for every open workspace.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_run_seq ON research_event(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_event_case ON research_event(case_id, seq);

CREATE TABLE IF NOT EXISTS candidate_product (
  id                    TEXT PRIMARY KEY,
  case_id               TEXT NOT NULL REFERENCES sourcing_case(id) ON DELETE CASCADE,
  run_id                TEXT NOT NULL REFERENCES research_run(id) ON DELETE CASCADE,
  supplier_name         TEXT NOT NULL,
  product_title         TEXT NOT NULL,
  source_url            TEXT NOT NULL,
  image_url             TEXT,
  retrieved_at          TEXT,
  status                TEXT NOT NULL,
  units_per_pack        INTEGER,
  price_per_pack_json   TEXT,
  min_order_packs       INTEGER,
  order_increment_packs INTEGER,
  dimensions_json       TEXT,
  material              TEXT,
  food_contact_claim    TEXT,
  shipping_info         TEXT,
  lead_time_info        TEXT,
  currency              TEXT,
  costing_json          TEXT,
  rationale             TEXT NOT NULL DEFAULT '',
  rank_score            REAL,
  dedupe_key            TEXT NOT NULL,
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidate_case ON candidate_product(case_id, rank_score DESC);
-- Same product found twice in one case collapses to one row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_dedupe ON candidate_product(case_id, dedupe_key);

CREATE TABLE IF NOT EXISTS evidence (
  id             TEXT PRIMARY KEY,
  case_id        TEXT NOT NULL REFERENCES sourcing_case(id) ON DELETE CASCADE,
  candidate_id   TEXT REFERENCES candidate_product(id) ON DELETE CASCADE,
  fact_path      TEXT NOT NULL,
  status         TEXT NOT NULL,
  authority      TEXT NOT NULL,
  source_url     TEXT,
  excerpt        TEXT,
  interpretation TEXT,
  retrieved_at   TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_candidate ON evidence(candidate_id, fact_path);

CREATE TABLE IF NOT EXISTS constraint_evaluation (
  id                TEXT PRIMARY KEY,
  case_id           TEXT NOT NULL REFERENCES sourcing_case(id) ON DELETE CASCADE,
  candidate_id      TEXT NOT NULL REFERENCES candidate_product(id) ON DELETE CASCADE,
  requirement_id    TEXT NOT NULL,
  requirement_label TEXT NOT NULL,
  priority          TEXT NOT NULL,
  outcome           TEXT NOT NULL CHECK (outcome IN ('met','failed','unknown','not_applicable')),
  explanation       TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_candidate ON constraint_evaluation(candidate_id);

CREATE TABLE IF NOT EXISTS quote_draft (
  id                   TEXT PRIMARY KEY,
  case_id              TEXT NOT NULL REFERENCES sourcing_case(id) ON DELETE CASCADE,
  candidate_id         TEXT NOT NULL REFERENCES candidate_product(id) ON DELETE CASCADE,
  supplier_name        TEXT NOT NULL,
  recipient_email      TEXT,
  recipient_source     TEXT,
  recipient_source_url TEXT,
  subject              TEXT NOT NULL,
  body                 TEXT NOT NULL,
  version              INTEGER NOT NULL DEFAULT 1,
  content_hash         TEXT NOT NULL,
  status               TEXT NOT NULL,
  questions_json       TEXT NOT NULL DEFAULT '[]',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draft_case ON quote_draft(case_id);

CREATE TABLE IF NOT EXISTS outreach_approval (
  id                 TEXT PRIMARY KEY,
  case_id            TEXT NOT NULL REFERENCES sourcing_case(id) ON DELETE CASCADE,
  draft_id           TEXT NOT NULL REFERENCES quote_draft(id) ON DELETE CASCADE,
  -- An approval pins the exact version and content it signed. If the draft is
  -- edited afterwards the hash no longer matches and the send is refused.
  draft_version      INTEGER NOT NULL,
  content_hash       TEXT NOT NULL,
  recipient_email    TEXT NOT NULL,
  approved_at        TEXT NOT NULL,
  invalidated_at     TEXT,
  invalidation_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_draft ON outreach_approval(draft_id, approved_at DESC);

CREATE TABLE IF NOT EXISTS email_attempt (
  id                  TEXT PRIMARY KEY,
  case_id             TEXT NOT NULL REFERENCES sourcing_case(id) ON DELETE CASCADE,
  draft_id            TEXT NOT NULL REFERENCES quote_draft(id) ON DELETE CASCADE,
  approval_id         TEXT NOT NULL,
  -- The uniqueness of this column is what prevents a double-click, a retry or a
  -- worker restart from sending the same request for quote twice.
  idempotency_key     TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL,
  provider_kind       TEXT NOT NULL,
  provider_message_id TEXT,
  provider_response   TEXT,
  error               TEXT,
  created_at          TEXT NOT NULL,
  completed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempt_draft ON email_attempt(draft_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_note (
  id               TEXT PRIMARY KEY,
  profile_id       TEXT NOT NULL REFERENCES business_profile(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  supplier_name    TEXT,
  text             TEXT NOT NULL,
  case_id          TEXT,
  synced_to_memory INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_profile ON supplier_note(profile_id, created_at DESC);

-- Job queue driving the out-of-band worker. Long research must survive the
-- browser closing, so the queue is persisted rather than held in memory.
CREATE TABLE IF NOT EXISTS job (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  case_id       TEXT NOT NULL,
  run_id        TEXT,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  -- Set when a worker claims the job; a stale lease is reclaimed on restart.
  locked_at     TEXT,
  locked_by     TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_claim ON job(status, created_at);
