import { loadEnvFiles } from '../src/lib/config/loadEnvFile';

loadEnvFiles();

import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/lib/config/load';
import { getDb, migrate } from '../src/lib/db/client';
import * as repo from '../src/lib/db/repo';
import { runResearch } from '../src/lib/agent/runner';
import { log } from '../src/lib/security/redact';

/**
 * The agent worker.
 *
 * Research runs here rather than inside a web request, for one reason: a
 * sourcing run takes minutes, and a business owner will close the tab. Job
 * state lives in SQLite, so progress survives a refresh, a server restart, or
 * the worker itself being killed mid-run.
 *
 * Deliberately a simple polling loop. A queue system would add operational
 * surface without changing what this can do at one-case-at-a-time scale.
 */

const WORKER_ID = `worker_${randomBytes(4).toString('hex')}`;
const POLL_INTERVAL_MS = 1000;

let shuttingDown = false;
let activeJobId: string | null = null;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = getDb();

  migrate(db);

  // Anything left `running` belonged to a worker that died. Put it back on the
  // queue so a killed worker cannot strand a case in RESEARCHING for ever.
  const reclaimed = repo.reclaimStaleJobs(db);
  if (reclaimed > 0) {
    log.info(`Reclaimed ${reclaimed} job(s) abandoned by a previous worker.`);
  }

  log.info(`Worker ${WORKER_ID} started in ${cfg.mode} mode. Polling for jobs.`);

  while (!shuttingDown) {
    const job = repo.claimNextJob(WORKER_ID, db);

    if (!job) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    activeJobId = job.id;
    log.info(`Claimed job ${job.id} (${job.kind}) for case ${job.caseId}.`);

    try {
      switch (job.kind) {
        case 'research': {
          if (!job.runId) throw new Error('Research job has no run id.');
          const outcome = await runResearch(job.caseId, job.runId, { cfg, db });
          log.info(
            `Job ${job.id} finished: ${outcome.status}, ${outcome.candidatesFound} candidate(s), ` +
              `${outcome.pagesFetched} page(s) read, ${outcome.pagesFailed} failed.`,
          );
          repo.finishJob(job.id, 'done', undefined, db);
          break;
        }
        default:
          throw new Error(`Unknown job kind "${job.kind}".`);
      }
    } catch (err) {
      const message = (err as Error).message;
      log.error(`Job ${job.id} failed`, { error: message });
      repo.finishJob(job.id, 'failed', message, db);

      // A crashed run must not leave the case looking like it is still working.
      if (job.runId) {
        repo.updateRun(
          job.runId,
          { status: 'failed', error: message, finishedAt: new Date().toISOString() },
          db,
        );
        repo.appendEvent(
          {
            caseId: job.caseId,
            runId: job.runId,
            kind: 'error',
            message: 'The research job stopped unexpectedly.',
            detail: message,
          },
          db,
        );
      }
      repo.setCaseState(job.caseId, 'FAILED', db);
    } finally {
      activeJobId = null;
    }
  }

  log.info('Worker stopped.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Graceful shutdown: stop taking new work, and release the job in flight so the
 * next worker retries it instead of it being lost.
 */
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Received ${signal}. Finishing up.`);

  if (activeJobId) {
    try {
      repo.reclaimStaleJobs(getDb());
      log.info('Released the in-flight job for another worker to pick up.');
    } catch (err) {
      log.error('Could not release the in-flight job', { error: (err as Error).message });
    }
  }
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  log.error('Worker crashed', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
