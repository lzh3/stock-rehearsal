export type Board = 'main' | 'gem' | 'star' | 'bse' | 'st';

/** 一根 K 线。date 统一使用 YYYY-MM-DD */
export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 成交量，缺失时为 0 */
  volume: number;
}

/** 预演 K 线，带上来源关键词，便于在图上和列表里标注 */
export interface ForecastBar extends Bar {
  note: string;
  tags: string[];
}

export interface Stock {
  id: string;
  code: string;
  name: string;
  board: Board;
  createdAt: number;
  updatedAt: number;
  /** 用户补充的信息（可选），只作参考 */
  fundamentals?: string;
  /** 自动拉取的行情快照（市值、估值、行业、板块强弱） */
  profile?: StockProfile;
}

export interface SectorRow {
  name: string;
  pct: number;
}

export interface SectorSnapshot {
  /** 涨幅居前的行业板块 */
  up: SectorRow[];
  /** 跌幅居前的行业板块 */
  down: SectorRow[];
  /** 板块总数 */
  total: number;
}

/** 个股行情快照，作为 AI 分析的"市场与基本面"输入 */
export interface StockProfile {
  code: string;
  name: string;
  industry?: string;
  region?: string;
  /** 最新价 */
  price?: number;
  /** 当日涨跌幅 % */
  changePct?: number;
  /** 成交量 */
  volume?: number;
  /** 成交额 */
  amount?: number;
  /** 总市值（元） */
  totalCap?: number;
  /** 流通市值（元） */
  floatCap?: number;
  /** 市盈率（动） */
  pe?: number;
  /** 市净率 */
  pb?: number;
  /** 换手率 % */
  turnover?: number;
  /** 所属行业当日涨跌幅 % */
  industryPct?: number;
  /** 所属行业在全市场行业板块中的涨幅排名（1 最强） */
  industryRank?: number;
  /** 行业板块强弱榜 */
  sector?: SectorSnapshot;
  fetchedAt: number;
}

export interface BarRecord extends Bar {
  /** `${stockId}|${date}`，作为 IndexedDB 主键 */
  key: string;
  stockId: string;
}

export interface ForecastRecord extends ForecastBar {
  key: string;
  stockId: string;
}
