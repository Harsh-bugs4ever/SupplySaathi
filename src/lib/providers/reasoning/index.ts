import type { AppConfig } from '../../config/load';
import { log } from '../../security/redact';
import type { ProviderHealth, ReasoningProvider, ReasoningRequest, ReasoningResult } from '../types';
import { DeepSeekProvider } from './deepseek';
import { DeterministicProvider } from './deterministic';

/**
 * ReasoningProvider with a rule-based safety net.
 *
 * DeepSeek handles messy real-world prose far better than regexes, so it leads.
 * But an outage, a rate limit or a malformed response must not take a sourcing
 * case down, so every task falls back to the deterministic implementation.
 *
 * Which one actually produced a result is surfaced — both in the research
 * timeline and on the evidence record — because "a model read this" and "a
 * regex read this" are different epistemic claims.
 */
export class FallbackReasoningProvider implements ReasoningProvider {
  readonly kind = 'deepseek+rules';

  private deepseekUsable = true;

  constructor(
    private readonly primary: ReasoningProvider | null,
    private readonly fallback: ReasoningProvider,
  ) {}

  async health(): Promise<ProviderHealth> {
    if (!this.primary) return this.fallback.health();
    return this.primary.health();
  }

  async complete<T>(req: ReasoningRequest<T>): Promise<ReasoningResult<T>> {
    if (this.primary && this.deepseekUsable) {
      try {
        return await this.primary.complete(req);
      } catch (err) {
        const message = (err as Error).message;
        log.warn(`DeepSeek failed on "${req.task}", falling back to rules`, { error: message });

        // An auth or model-name failure will recur on every subsequent call;
        // stop paying the timeout for the rest of the run.
        if (/401|403|not configured|was not found/i.test(message)) {
          this.deepseekUsable = false;
        }
      }
    }
    return this.fallback.complete(req);
  }

  /** True when the last completion came from the rule-based path. */
  get degraded(): boolean {
    return !this.primary || !this.deepseekUsable;
  }
}

export function createReasoningProvider(cfg: AppConfig, mode: 'demo' | 'live'): ReasoningProvider {
  const fallback = new DeterministicProvider();

  // Demo mode must be deterministic and offline, so it never calls a model.
  if (mode === 'demo') return fallback;
  if (!cfg.deepseek.apiKey) return fallback;

  return new FallbackReasoningProvider(new DeepSeekProvider(cfg.deepseek), fallback);
}

export { DeepSeekProvider, DeterministicProvider };
