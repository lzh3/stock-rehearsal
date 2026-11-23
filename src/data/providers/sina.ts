import type { Bar } from '../../core/types';
import type { FetchRange, FetchResult, HistoryProvider, ProviderMeta } from './index';
import { requestJson } from '../http';
import { toMarketSymbol } from '../symbol';

interface SinaRow {
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export const sinaMeta: ProviderMeta = {
  id: 'sina',
  label: '新浪行情（备用）',
  hint: '第三备选；不复权日线，最多约 1000 根',
};

export class SinaProvider implements HistoryProvider {
  readonly meta = sinaMeta;

  async fetchHistory(code: string, range: FetchRange): Promise<FetchResult> {
    const symbol = toMarketSymbol(code);
    if (symbol.market === 'bj') {
      throw new Error('新浪备用接口暂不支持北交所，请切换东方财富数据源');
    }
    const params = new URLSearchParams({
      symbol: symbol.symbol,
      scale: '240',
      ma: 'no',
      datalen: '1023',
    });
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?${params.toString()}`;
    const rows = await requestJson<SinaRow[]>({
      url,
      origin: 'https://money.finance.sina.com.cn',
      proxyPrefix: '/api/sina',
      jsonp: false,
    });
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error(`新浪接口返回空数据，代码 ${symbol.code}`);
    }

    const bars: Bar[] = [];
    for (const row of rows) {
      const open = Number(row.open);
      const high = Number(row.high);
      const low = Number(row.low);
      const close = Number(row.close);
      if (![open, high, low, close].every(Number.isFinite)) continue;
      if (range.begin && row.day < range.begin) continue;
      if (range.end && row.day > range.end) continue;
      bars.push({
        date: row.day,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.max(0, Math.round(Number(row.volume) || 0)),
      });
    }
    if (!bars.length) throw new Error(`代码 ${symbol.code} 在该日期范围内没有数据`);

    return {
      bars: bars.sort((a, b) => a.date.localeCompare(b.date)),
      source: sinaMeta.label,
      fetchedAt: Date.now(),
      code: symbol.code,
    };
  }
}
