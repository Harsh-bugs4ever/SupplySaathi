import { sanitizePageContent } from '../../security/sanitize';
import { FIXTURE_SEARCH_RESULTS, findFixture } from '../../fixtures/pages';
import type {
  FetchOutcome,
  ProviderHealth,
  SearchResult,
  WebResearchProvider,
} from '../types';

/**
 * Demo-mode WebResearchProvider.
 *
 * Satisfies the same interface as the live providers, so demo mode exercises
 * the real extraction, costing, constraint and ranking code — only retrieval is
 * substituted. That is the difference between a demo that proves the workflow
 * and a demo that is a screenshot.
 *
 * It is deliberately impossible for this provider to reach the network.
 */
export class FixtureWebProvider implements WebResearchProvider {
  readonly kind = 'fixture';

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.kind,
      configured: true,
      checkedAt: new Date().toISOString(),
      capabilities: [
        {
          name: 'page_retrieval',
          available: true,
          detail: 'Deterministic sample pages. No network access.',
        },
        {
          name: 'search',
          available: true,
          detail: 'Returns the fixed sample supplier set.',
        },
      ],
    };
  }

  async search(_query: string, limit: number): Promise<SearchResult[]> {
    return FIXTURE_SEARCH_RESULTS.slice(0, limit);
  }

  async fetchPage(url: string): Promise<FetchOutcome> {
    const attemptedAt = new Date().toISOString();
    const fixture = findFixture(url);

    if (!fixture) {
      return {
        ok: false,
        failure: {
          url,
          reason: 'No sample page exists for this URL. Demo mode only covers the sample suppliers.',
          attemptedAt,
          provider: this.kind,
          retryable: false,
        },
      };
    }

    // One fixture models a retrieval failure, because a shortlist that has
    // never had to show a failed fetch has not been properly reviewed.
    if (fixture.failure) {
      return {
        ok: false,
        failure: {
          url,
          reason: fixture.failure,
          attemptedAt,
          provider: this.kind,
          retryable: true,
        },
      };
    }

    const sanitized = sanitizePageContent(fixture.markdown);
    return {
      ok: true,
      page: {
        url: fixture.url,
        markdown: sanitized.text,
        title: fixture.title,
        retrievedAt: attemptedAt,
        provider: this.kind,
        truncated: sanitized.truncated,
        injectionFlags: sanitized.injectionFlags,
      },
    };
  }
}
