import type { StockProfile, SectorSnapshot } from '../../core/types';
import { requestJson } from '../http';
import { toSecid } from './eastmoney';

/** 东方财富行情快照：一次拿到市值、估值、换手、行业，作为 AI 的"基本面/市场环境"输入
 *
 * 用的是 quote 域（push2.eastmoney.com），和 K 线域（push2his）分开，
 * 便于分别配置代理与失败回退。
 */
const QUOTE_ORIGIN = 'https://push2.eastmoney.com';
const QUOTE_PATH = '/api/qt/stock/get';
const LIST_PATH = '/api/qt/clist/get';

const QUOTE_FIELDS = [
  'f57', // 代码
  'f58', // 名称
  'f43', // 最新价
  'f60', // 昨收
  'f169', // 涨跌额
  'f170', // 涨跌幅
  'f47', // 成交量
  'f48', // 成交额
  'f116', // 总市值
  'f117', // 流通市值
  'f162', // 市盈率(动)
  'f167', // 市净率
  'f168', // 换手率
  'f127', // 行业
  'f128', // 地区/板块
].join(',');

interface EmQuoteResponse {
  rc?: number;
  data?: Record<string, unknown> | null;
}

interface EmListResponse {
  rc?: number;
  data?: { total?: number; diff?: Array<Record<string, unknown>> } | null;
}

function num(value: unknown): number | undefined {
  if (value == null || value === '-' || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value === '-') return undefined;
  return value;
}

/** 行业板块涨跌排行（用于给模型一个"今天市场在炒什么"的坐标） */
async function fetchSectorBoard(): Promise<{ rows: Array<{ name: string; pct: number }>; total: number } | null> {
  const params = new URLSearchParams({
    pn: '1',
    pz: '100',
    po: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fid: 'f3',
    fs: 'm:90+t:2', // 行业板块
    fields: 'f12,f14,f3',
  });
  const url = `${QUOTE_ORIGIN}${LIST_PATH}?${params.toString()}`;

  const resp = await requestJson<EmListResponse>({
    url,
    origin: QUOTE_ORIGIN,
    proxyPrefix: '/api/em-quote',
    timeoutMs: 15000,
  });

  const diff = resp.data?.diff;
  if (!Array.isArray(diff) || !diff.length) return null;

  const rows = diff
    .map((row) => ({
      name: str(row['f14']) ?? '',
      pct: num(row['f3']) ?? 0,
    }))
    .filter((row) => row.name);

  if (!rows.length) return null;
  return { rows, total: resp.data?.total ?? rows.length };
}

/** 拉取个股快照 + 行业板块强弱；任一部分失败都不影响其他部分 */
export async function fetchStockProfile(input: string): Promise<StockProfile> {
  const secid = toSecid(input);
  const params = new URLSearchParams({
    secid,
    fltt: '2',
    invt: '2',
    fields: QUOTE_FIELDS,
  });
  const url = `${QUOTE_ORIGIN}${QUOTE_PATH}?${params.toString()}`;

  const [quoteResult, sectorResult] = await Promise.allSettled([
    requestJson<EmQuoteResponse>({
      url,
      origin: QUOTE_ORIGIN,
      proxyPrefix: '/api/em-quote',
      timeoutMs: 15000,
    }),
    fetchSectorBoard(),
  ]);

  if (quoteResult.status === 'rejected') {
    throw new Error(quoteResult.reason instanceof Error ? quoteResult.reason.message : String(quoteResult.reason));
  }

  const data = quoteResult.value?.data;
  if (!data) throw new Error('行情快照返回空数据（代码可能不存在或已退市）');

  const industry = str(data['f127']);
  const board = sectorResult.status === 'fulfilled' ? sectorResult.value : null;

  let industryPct: number | undefined;
  let industryRank: number | undefined;
  if (industry && board) {
    const idx = board.rows.findIndex((row) => row.name === industry);
    if (idx >= 0) {
      industryRank = idx + 1;
      industryPct = board.rows[idx].pct;
    }
  }

  const sector: SectorSnapshot | undefined = board
    ? {
        up: board.rows.slice(0, 6),
        down: board.rows.slice(-6).reverse(),
        total: board.total,
      }
    : undefined;

  return {
    code: str(data['f57']) ?? secid.split('.')[1],
    name: str(data['f58']) ?? '',
    industry,
    region: str(data['f128']),
    price: num(data['f43']),
    changePct: num(data['f170']),
    volume: num(data['f47']),
    amount: num(data['f48']),
    totalCap: num(data['f116']),
    floatCap: num(data['f117']),
    pe: num(data['f162']),
    pb: num(data['f167']),
    turnover: num(data['f168']),
    industryPct,
    industryRank,
    sector: sector ?? undefined,
    fetchedAt: Date.now(),
  };
}
