import { postJson, HttpError } from '../http';
import { log } from '../../security/redact';
import type {
  ProviderHealth,
  ReasoningProvider,
  ReasoningRequest,
  ReasoningResult,
} from '../types';

/**
 * DeepSeek ReasoningProvider.
 *
 * API surface verified against https://api-docs.deepseek.com:
 *   POST {baseUrl}/chat/completions
 *   Authorization: Bearer <key>
 *   OpenAI-compatible body; `response_format: { type: 'json_object' }` for JSON.
 *
 * Current model identifiers are `deepseek-flash` and `deepseek-v4-pro`. The
 * model name is configurable rather than hard-coded precisely because that list
 * changes; `DEEPSEEK_MODEL` is passed straight through.
 */

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  model?: string;
  error?: { message?: string };
}

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export class DeepSeekProvider implements ReasoningProvider {
  readonly kind = 'deepseek';

  constructor(private readonly cfg: DeepSeekConfig) {}

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.cfg.apiKey) {
      return {
        provider: this.kind,
        configured: false,
        checkedAt,
        capabilities: [
          {
            name: 'chat_completions',
            available: false,
            detail: 'DEEPSEEK_API_KEY is not set. Brief parsing and extraction fall back to rules.',
          },
        ],
      };
    }

    try {
      // A one-token completion is the cheapest way to prove the key AND the
      // configured model name are both valid. Listing models would not catch a
      // model name the account cannot actually call.
      await postJson<ChatCompletionResponse>(
        `${this.cfg.baseUrl}/chat/completions`,
        {
          model: this.cfg.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        },
        { Authorization: `Bearer ${this.cfg.apiKey}` },
        { timeoutMs: Math.min(this.cfg.timeoutMs, 20_000), retries: 0, label: 'DeepSeek health' },
      );

      return {
        provider: this.kind,
        configured: true,
        checkedAt,
        capabilities: [
          { name: 'chat_completions', available: true, detail: `Model ${this.cfg.model} responded.` },
          { name: 'json_output', available: true, detail: 'Structured output via response_format.' },
        ],
      };
    } catch (err) {
      const e = err as HttpError;
      return {
        provider: this.kind,
        configured: true,
        checkedAt,
        error: e.message,
        capabilities: [
          {
            name: 'chat_completions',
            available: false,
            detail:
              e.status === 401
                ? 'DeepSeek rejected the API key.'
                : e.status === 404
                  ? `Model "${this.cfg.model}" was not found. Check DEEPSEEK_MODEL.`
                  : e.message,
          },
        ],
      };
    }
  }

  async complete<T>(req: ReasoningRequest<T>): Promise<ReasoningResult<T>> {
    if (!this.cfg.apiKey) {
      throw new Error('DeepSeek is not configured (DEEPSEEK_API_KEY is empty).');
    }

    const messages = [
      { role: 'system' as const, content: req.system },
      { role: 'user' as const, content: req.user },
    ];

    const first = await this.call(messages, req);
    const parsed = tryParse(first);
    if (parsed.ok) {
      const validated = req.validate(parsed.value);
      if (validated.ok) {
        return { value: validated.value, raw: first, model: this.cfg.model, retried: false };
      }
      log.warn(`DeepSeek ${req.task} failed schema validation`, { error: validated.error });

      // One repair attempt. The model is shown its own output and the specific
      // validation error — not just asked to "try again", which tends to
      // reproduce the same mistake.
      const repaired = await this.call(
        [
          ...messages,
          { role: 'assistant' as const, content: first },
          {
            role: 'user' as const,
            content:
              `That response did not satisfy the ${req.schemaName} schema. ` +
              `Validation error: ${validated.error}\n\n` +
              `Return ONLY corrected JSON matching the schema. No prose, no code fences.`,
          },
        ],
        req,
      );

      const reparsed = tryParse(repaired);
      if (!reparsed.ok) {
        throw new Error(`DeepSeek ${req.task}: response was not valid JSON after one repair attempt.`);
      }
      const revalidated = req.validate(reparsed.value);
      if (!revalidated.ok) {
        throw new Error(
          `DeepSeek ${req.task}: response still failed ${req.schemaName} validation after repair: ${revalidated.error}`,
        );
      }
      return { value: revalidated.value, raw: repaired, model: this.cfg.model, retried: true };
    }

    throw new Error(`DeepSeek ${req.task}: response was not valid JSON.`);
  }

  private async call<T>(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    req: ReasoningRequest<T>,
  ): Promise<string> {
    const res = await postJson<ChatCompletionResponse>(
      `${this.cfg.baseUrl}/chat/completions`,
      {
        model: this.cfg.model,
        messages,
        temperature: req.temperature ?? 0.1,
        max_tokens: req.maxTokens ?? 4000,
        response_format: { type: 'json_object' },
        stream: false,
      },
      { Authorization: `Bearer ${this.cfg.apiKey}` },
      { timeoutMs: this.cfg.timeoutMs, retries: 2, label: `DeepSeek ${req.task}` },
    );

    if (res.error?.message) throw new Error(`DeepSeek error: ${res.error.message}`);

    const content = res.choices?.[0]?.message?.content;
    if (!content) throw new Error(`DeepSeek ${req.task}: empty response.`);

    if (res.choices?.[0]?.finish_reason === 'length') {
      log.warn(`DeepSeek ${req.task} hit the output token limit; JSON may be truncated.`);
    }
    return content;
  }
}

/** Tolerate code fences and stray prose around the JSON body. */
function tryParse(raw: string): { ok: true; value: unknown } | { ok: false } {
  const attempts = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
  ];
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    attempts.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const a of attempts) {
    try {
      return { ok: true, value: JSON.parse(a.trim()) };
    } catch {
      /* try the next shape */
    }
  }
  return { ok: false };
}
