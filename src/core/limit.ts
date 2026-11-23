import type { Board } from './types';
import { round2 } from './format';

export interface BoardMeta {
  label: string;
  short: string;
  rate: number;
}

export const BOARDS: Record<Board, BoardMeta> = {
  main: { label: '主板 / 中小板 ±10%', short: '主板', rate: 0.1 },
  gem: { label: '创业板 ±20%', short: '创业板', rate: 0.2 },
  star: { label: '科创板 ±20%', short: '科创板', rate: 0.2 },
  bse: { label: '北交所 ±30%', short: '北交所', rate: 0.3 },
  st: { label: 'ST / *ST ±5%', short: 'ST', rate: 0.05 },
};

export function limitRate(board: Board): number {
  return BOARDS[board].rate;
}

/** 按 A 股规则计算涨停 / 跌停价（四舍五入到分） */
export function limitPrices(prevClose: number, board: Board): { up: number; down: number } {
  const rate = limitRate(board);
  return {
    up: round2(prevClose * (1 + rate)),
    down: round2(prevClose * (1 - rate)),
  };
}

export function isLimitUp(close: number, prevClose: number, board: Board): boolean {
  return Math.abs(close - limitPrices(prevClose, board).up) < 0.005;
}

export function isLimitDown(close: number, prevClose: number, board: Board): boolean {
  return Math.abs(close - limitPrices(prevClose, board).down) < 0.005;
}

/** 根据股票代码猜测板块，用于新建股票时的默认值 */
export function guessBoard(code: string): Board {
  const c = code.replace(/\D/g, '');
  if (/^(688|689)/.test(c)) return 'star';
  if (/^(300|301)/.test(c)) return 'gem';
  if (/^(4|8|92)/.test(c)) return 'bse';
  return 'main';
}
