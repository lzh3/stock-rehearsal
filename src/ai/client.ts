import type { AiConfig } from './types';

/** 把 /chat/completions 路径拼到 baseUrl 上，兼容带 /v1 和不带的地址 */
export function completionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/chat/completions`;
}

/** 抽取最终文本内容（兼容多种平台返回格式） */
function extractText(payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null;
  const choices = p?.['choices'];
  if (!Array.isArray(choices) || !choices.length) return null;
  const choice = choices[0] as Record<string, unknown>;
  const message = choice['message'];
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>)['content'];
    if (typeof content === 'string' && content) return content;
  }
  const delta = choice['delta'];
  if (delta && typeof delta === 'object') {
    const content = (delta as Record<string, unknown>)['content'];
    if (typeof content === 'string' && content) return content;
  }
  const textField = choice['text'];
  if (typeof textField === 'string' && textField) return textField;
  return null;
}

/**
 * 调用 OpenAI 兼容的 chat/completions 接口。
 * 开发环境下若 baseUrl 为本地或直接填的公网地址且浏览器被 CORS 拦截，
 * 建议在 vite.config.ts 加 `/api/llm` 代理，此处只负责调用自己传入的 baseUrl。
 */
export async function chatCompletions(config: AiConfig, prompt: string, signal: AbortSignal): Promise<string> {
  const url = completionsUrl(config.baseUrl);
  const body = JSON.stringify({
    model: config.model,
    temperature: config.temperature,
    messages: [
      { role: 'system', content: '你是严谨的 A 股研究助理。只根据给到的数据与基本面分析，不凭空编造财务数据，不承诺盈利，输出严格的 JSON，不要包含代码块。' },
      { role: 'user', content: prompt },
    ],
    stream: false,
  });

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body,
  });

  if (!res.ok) {
    const tail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${tail ? `：${tail.slice(0, 200)}` : ''}`);
  }

  const payload = await res.json().catch(() => ({}));
  const text = extractText(payload);
  if (!text) throw new Error('大模型未返回有效内容');
  return text;
}

/** 把模型返回的文本里找出第一个 JSON 对象（兼容 ... ```json {...} ...） */
export function extractJson(text: string): Record<string, unknown> | null {
  const fence = /```json\s*(\{[\s\S]*?\})\s*```/i.exec(text);
  const block = fence ? fence[1] : null;
  const direct = /\{[\s\S]*\}/.exec(text);
  const candidates: (string | null | undefined)[] = [block, direct?.[0], text.trim()];
  const strings = candidates.filter((s): s is string => typeof s === 'string');
  for (const cand of strings) {
    try {
      const parsed = JSON.parse(cand);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // continue
    }
  }
  return null;
}
