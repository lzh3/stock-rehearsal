/** 统一的行情请求工具
 *
 * 浏览器直接请求第三方行情接口，常见的坑有三个：
 * 1. 没有 CORS 头 —— 用 fetch 会被拦；
 * 2. 接口返回 text/plain 之类非 JS 的 MIME —— 用 JSONP（<script>）会被浏览器拒绝执行；
 * 3. 服务端反爬（缺 User-Agent / Referer）—— 直接 500 / socket hang up。
 *
 * 所以这里按「开发环境代理 → 直连 fetch → JSONP」的顺序逐个尝试，
 * 把每一路的失败原因都收集起来，方便定位到底是哪一步挂了。
 */

const DEFAULT_TIMEOUT = 15000;

export interface JsonRequest {
  /** 完整原始地址，例如 https://web.ifzq.gtimg.cn/appstock/... */
  url: string;
  /** 原始域名，用于替换成代理前缀 */
  origin: string;
  /** 开发环境代理前缀，例如 /api/tencent */
  proxyPrefix?: string;
  /** 是否允许 JSONP 兜底（接口支持 cb 回调时才有意义） */
  jsonp?: boolean;
  timeoutMs?: number;
}

function describeError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'AbortError') return '请求超时';
    return e.message;
  }
  return String(e);
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (!res.ok) {
      // 服务端错误时尽量把响应体带出来，便于判断是不是被反爬拦了
      const body = await res.text().catch(() => '');
      const brief = body.slice(0, 120).replace(/\s+/g, ' ').trim();
      throw new Error(`HTTP ${res.status}${brief ? `：${brief}` : ''}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function jsonp<T>(url: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cb = `__q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const script = document.createElement('script');
    script.async = true;
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      delete (window as any)[cb];
      script.remove();
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP 超时'));
    }, timeoutMs);

    (window as any)[cb] = (data: T) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP 加载失败（脚本未执行，可能 MIME 类型或跨域策略被拦）'));
    };
    script.src = `${url}${url.includes('?') ? '&' : '?'}cb=${cb}`;
    document.head.appendChild(script);
  });
}

/** 依次尝试代理 / 直连 / JSONP，全部失败时抛出聚合错误 */
export async function requestJson<T>(req: JsonRequest): Promise<T> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT;
  const attempts: Array<{ label: string; run: () => Promise<T> }> = [];

  const proxyUrl = req.proxyPrefix ? req.url.replace(req.origin, req.proxyPrefix) : null;
  if (proxyUrl && import.meta.env.DEV) {
    attempts.push({ label: '本地代理', run: () => fetchJson<T>(proxyUrl, timeoutMs) });
  }
  attempts.push({ label: '直连', run: () => fetchJson<T>(req.url, timeoutMs) });
  if (req.jsonp) {
    attempts.push({ label: 'JSONP', run: () => jsonp<T>(req.url, timeoutMs) });
  }

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await attempt.run();
    } catch (e) {
      errors.push(`${attempt.label}：${describeError(e)}`);
    }
  }

  throw new Error(errors.join(' ｜ '));
}

export { describeError };
