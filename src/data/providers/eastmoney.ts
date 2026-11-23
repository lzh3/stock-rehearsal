import type { Bar } from '../../core/types';
import type { FetchRange, FetchResult, HistoryProvider, ProviderMeta } from './index';
import { requestJson } from '../http';

/** 东方财富行情（公开接口，无需密钥）
 *
 * 请求地址：https://push2his.eastmoney.com/api/qt/stock/kline/get
 * 该接口在服务端缺 User-Agent 时容易直接断开连接（表现为代理 500 / socket hang up），
 * 所以开发环境走 Vite 代理并补齐请求头，同时保留 JSONP 与直连两条兜底路径。
 */

const API_ORIGIN = 'https://push2his.eastmoney.com';
const KLINE_PATH = '/api/qt/stock/kline/get';

export const eastmoneyMeta: ProviderMeta = {
  id: 'eastmoney',
  label: '东方财富（免费行情）',
  hint: '沪深 A 股 / 北交所 日线，前复权；不需要密钥，直接填 6 位股票代码即可拉取',
};

/** 把常见代码写法规范为东方财富 secid，如 600000 -> 1.600000，000001 -> 0.000001 */
export function toSecid(input: string): string {
  const raw = input.trim().toLowerCase();

  // 已是 secid 形式：1.600000 / 0.000001 / 8.430001
  const dotted = /^([0-9])\.(\d{6})$/.exec(raw);
  if (dotted) return raw;

  // 带市场前缀：sh600000 / sz000001 / bj430001
  const prefixed = /^(sh|sz|bj)(\d{6})$/.exec(raw);
  if (prefixed) {
    const market = prefixed[1] === 'sh' ? 1 : prefixed[1] === 'sz' ? 0 : 8;
    return `${market}.${prefixed[2]}`;
  }

  const code = raw.replace(/\D/g, '');
  if (code.length !== 6) {
    throw new Error('股票代码需要 6 位数字，例如 600000、000001、300750');
  }
  if (/^(6|9)/.test(code)) return `1.${code}`; // 上交所（含科创板 688）
  if (/^(0|2|3)/.test(code)) return `0.${code}`; // 深交所（含创业板 300）
  if (/^(4|8)/.test(code)) return `8.${code}`; // 北交所
  return `0.${code}`;
}

interface EmKlineResponse {
  rc?: number;
  rt?: string;
  data?: {
    code?: string;
    name?: string;
    dktotal?: number;
    klines?: string[];
  };
  msg?: string;
}

/** 将东方财富原始 K 线数组（字符串，字段已按 f51..f58 顺序返回）转换为 Bar */
function mapKlines(klines: string[]): Bar[] {
  const seen = new Set<string>();
  const bars: Bar[] = [];
  for (const line of klines) {
    const parts = line.split(',');
    const date = parts[0]?.trim();
    if (!date || seen.has(date)) continue;
    seen.add(date);

    const o = Number(parts[1]);
    const h = Number(parts[3]);
    const l = Number(parts[4]);
    const c = Number(parts[2]);
    const v = Math.max(0, Math.round(Number(parts[5]) || 0));

    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) {
      continue;
    }

    bars.push({
      date,
      open: Math.round(o * 100) / 100,
      high: Math.round(h * 100) / 100,
      low: Math.round(l * 100) / 100,
      close: Math.round(c * 100) / 100,
      volume: v,
    });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return bars;
}

/** 东方财富的 beg/end 只认 YYYYMMDD，传入 YYYY-MM-DD 会返回空 klines */
export function toEmDate(input?: string, fallback = ''): string {
  if (!input) return fallback;
  const digits = input.replace(/\D/g, '');
  return digits.length === 8 ? digits : fallback;
}

export class EastmoneyProvider implements HistoryProvider {
  readonly meta = eastmoneyMeta;

  /** 尝试指定复权方式与日期范围拉取；
   *  若指定日期区间下 klines 为空但 dktotal>0，再尝试全量日期（beg=0/end=20500101）。
   *  fqt=1（前复权）无数据时 fallback 到 fqt=0（不复权）。
   */
  async fetchHistory(code: string, range: FetchRange): Promise<FetchResult> {
    const secid = toSecid(code);
    const klt = 101; // 101 = 日线

    const lastErr: string[] = [];
    const fqtList = [1, 0] as const;

    const tryFetch = async (fqt: number, begin: string, end: string) => {
      const params = new URLSearchParams({
        secid,
        ut: 'fa5fd1943c7b386f172d6893dbfba10b',
        fields1: 'f1,f2,f3,f4,f5,f6',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
        klt: String(klt),
        fqt: String(fqt),
        beg: begin,
        end: end,
        lmt: '5000',
      });

      const url = `${API_ORIGIN}${KLINE_PATH}?${params.toString()}`;
      let response: EmKlineResponse;
      try {
        response = await requestJson<EmKlineResponse>({
          url,
          origin: API_ORIGIN,
          proxyPrefix: '/api/em-his',
          jsonp: true,
          timeoutMs: 20000,
        });
      } catch (e) {
        throw new Error(`${(e as Error).message}`);
      }

      if (response?.rc != null && response.rc !== 0) {
        throw new Error(`返回码 ${response.rc}${response.msg ? `（${response.msg}）` : ''}`);
      }

      if (!response || !response.data || !response.data.klines || response.data.klines.length === 0) {
        const dktotal = response?.data?.dktotal;
        const hint = response?.msg ? `（${response.msg}）` : '';
        const totalHint = dktotal != null ? `，dktotal=${dktotal}` : '';
        throw new Error(`返回空数据${totalHint}${hint}`);
      }

      const bars = mapKlines(response.data.klines);
      if (!bars.length) {
        throw new Error(`K 线映射后为空`);
      }

      return {
        bars,
        source: eastmoneyMeta.label,
        fetchedAt: Date.now(),
        name: response.data.name ?? undefined,
        code: secid,
      };
    };

    // 1) 优先按用户指定的日期区间 + 复权方式尝试
    for (const fqt of fqtList) {
      try {
        return await tryFetch(
          fqt,
          toEmDate(range.begin, '0'),
          toEmDate(range.end, '20500101')
        );
      } catch (e) {
        lastErr.push(`fqt=${fqt} 指定日期：${(e as Error).message}`);
      }
    }

    // 2) 指定日期区间全部空时，再尝试全量日期（beg=0/end=20500101），排除区间导致的空数据
    for (const fqt of fqtList) {
      try {
        return await tryFetch(fqt, '0', '20500101');
      } catch (e) {
        lastErr.push(`fqt=${fqt} 全量日期：${(e as Error).message}`);
      }
    }

    throw new Error(`东方财富无可用数据，代码 ${code}：${lastErr.join('；')}`);
  }
}
