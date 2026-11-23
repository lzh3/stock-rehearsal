import type { Bar } from '../../core/types';
import type { FetchRange, FetchResult, HistoryProvider, ProviderMeta } from './index';
import { requestJson } from '../http';
import { toMarketSymbol } from '../symbol';
import { shiftDays } from '../../core/dates';

interface TencentResponse {
  code?: number;
  msg?: string;
  data?: Record<string, {
    code?: string;
    name?: string;
    /** 前复权日线，每行 [日期, 开, 收, 高, 低, 量] */
    qfqday?: string[][];
    /** 不复权日线 */
    day?: string[][];
    qt?: Record<string, string[]>;
  }>;
}

const API_ORIGIN = 'https://web.ifzq.gtimg.cn';
const KLINE_PATH = '/appstock/app/fqkline/get';
/** 单次请求上限，超过会被服务端截断 */
const PAGE_SIZE = 640;
const MAX_PAGES = 8;

export const tencentMeta: ProviderMeta = {
  id: 'tencent',
  label: '腾讯行情',
  hint: '前复权日线，单次最多 640 根，超出会自动向前翻页补齐',
};

/**
 * 腾讯每行是 [日期, 开盘, 收盘, 最高, 最低, 成交量]。
 * 各家顺序容易记错，这里按「高>=max(开,收)、低<=min(开,收)」做一次校验，
 * 如果多数行不满足，就换用 [日期, 开, 高, 低, 收] 的解释。
 */
function mapRows(rows: string[][]): Bar[] {
  const parse = (row: string[], order: 'OCHL' | 'OC_HL'): Bar | null => {
    const date = row[0]?.trim();
    if (!date) return null;
    const a = Number(row[1]);
    const b = Number(row[2]);
    const c = Number(row[3]);
    const d = Number(row[4]);
    if (![a, b, c, d].every(Number.isFinite)) return null;
    const volume = Math.max(0, Math.round(Number(row[5]) || 0));
    const bar: Bar =
      order === 'OC_HL'
        ? { date, open: a, close: b, high: c, low: d, volume } // [日期,开,收,高,低]
        : { date, open: a, high: b, low: c, close: d, volume }; // [日期,开,高,低,收]
    return bar;
  };

  const ordered = rows.filter((r) => r.length >= 6);
  if (!ordered.length) return [];

  const sample = ordered.slice(-40);
  const score = (order: 'OCHL' | 'OC_HL') => {
    let ok = 0;
    for (const row of sample) {
      const bar = parse(row, order);
      if (!bar) continue;
      const eps = 1e-6;
      if (
        bar.high + eps >= Math.max(bar.open, bar.close) &&
        bar.low - eps <= Math.min(bar.open, bar.close) &&
        bar.high + eps >= bar.low
      ) {
        ok += 1;
      }
    }
    return ok;
  };

  const order: 'OCHL' | 'OC_HL' = score('OC_HL') >= score('OCHL') ? 'OC_HL' : 'OCHL';

  const bars: Bar[] = [];
  const seen = new Set<string>();
  for (const row of ordered) {
    const bar = parse(row, order);
    if (!bar || seen.has(bar.date)) continue;
    seen.add(bar.date);
    bars.push({
      date: bar.date,
      open: Math.round(bar.open * 100) / 100,
      high: Math.round(bar.high * 100) / 100,
      low: Math.round(bar.low * 100) / 100,
      close: Math.round(bar.close * 100) / 100,
      volume: bar.volume,
    });
  }
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

export class TencentProvider implements HistoryProvider {
  readonly meta = tencentMeta;

  private async fetchPage(symbol: string, begin: string, end: string) {
    const params = new URLSearchParams({
      param: `${symbol},day,${begin},${end},${PAGE_SIZE},qfq`,
    });
    const url = `${API_ORIGIN}${KLINE_PATH}?${params.toString()}`;
    const response = await requestJson<TencentResponse>({
      url,
      origin: API_ORIGIN,
      proxyPrefix: '/api/tencent',
      timeoutMs: 15000,
    });
    if (response.code != null && response.code !== 0) {
      throw new Error(response.msg || `腾讯接口返回错误码 ${response.code}`);
    }
    const item = response.data?.[symbol];
    if (!item) return { bars: [] as Bar[], name: undefined as string | undefined };
    const name = item.name ?? Object.values(item.qt ?? {})[0]?.[1];
    return { bars: mapRows(item.qfqday ?? item.day ?? []), name };
  }

  async fetchHistory(code: string, range: FetchRange): Promise<FetchResult> {
    const { symbol, code: digits, market } = toMarketSymbol(code);
    if (market === 'bj') {
      throw new Error('腾讯接口暂不支持北交所，请改用东方财富数据源');
    }

    const begin = range.begin || '1991-01-01';
    const end = range.end || '2099-12-31';

    const collected = new Map<string, Bar>();
    let cursorEnd = end;
    let name: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { bars, name: pageName } = await this.fetchPage(symbol, begin, cursorEnd);
      if (pageName && !name) name = pageName;
      if (!bars.length) break;

      let fresh = 0;
      for (const bar of bars) {
        if (!collected.has(bar.date)) {
          collected.set(bar.date, bar);
          fresh += 1;
        }
      }
      const earliest = bars[0].date;
      // 已经覆盖到起始日期、本页没拿到新数据、或本页不足一页，就停止翻页
      if (earliest <= begin || fresh === 0 || bars.length < PAGE_SIZE / 2) break;
      cursorEnd = shiftDays(earliest, -1);
    }

    const result = [...collected.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!result.length) {
      throw new Error(`腾讯接口返回空数据，代码 ${digits}`);
    }

    return {
      bars: result,
      source: tencentMeta.label,
      fetchedAt: Date.now(),
      name,
      code: digits,
    };
  }
}
