export type Market = 'sh' | 'sz' | 'bj';

export interface MarketSymbol {
  /** 带市场前缀的代码，如 sh600000 */
  symbol: string;
  /** 纯 6 位代码 */
  code: string;
  market: Market;
}

/** 把用户输入规范成「市场前缀 + 6 位代码」，腾讯 / 新浪都用这种写法 */
export function toMarketSymbol(input: string): MarketSymbol {
  const raw = input.trim().toLowerCase();

  const prefixed = /^(sh|sz|bj)(\d{6})$/.exec(raw);
  if (prefixed) {
    return {
      symbol: `${prefixed[1]}${prefixed[2]}`,
      code: prefixed[2],
      market: prefixed[1] as Market,
    };
  }

  // 兼容东财的 secid 写法：1.600000 / 0.000001 / 8.430001
  const dotted = /^([0-9])\.(\d{6})$/.exec(raw);
  if (dotted) {
    const code = dotted[2];
    const market: Market = dotted[1] === '1' ? 'sh' : dotted[1] === '8' ? 'bj' : 'sz';
    return { symbol: `${market}${code}`, code, market };
  }

  const code = raw.replace(/\D/g, '');
  if (code.length !== 6) {
    throw new Error('股票代码需要 6 位数字，例如 600000、000001、300750');
  }
  if (/^(6|9)/.test(code)) return { symbol: `sh${code}`, code, market: 'sh' };
  if (/^(4|8)/.test(code)) return { symbol: `bj${code}`, code, market: 'bj' };
  return { symbol: `sz${code}`, code, market: 'sz' };
}
