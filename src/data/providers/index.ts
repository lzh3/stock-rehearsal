import type { Bar } from '../../core/types';
import { AutoProvider } from './auto';
import { EastmoneyProvider } from './eastmoney';
import { MockProvider } from './mock';
import { SinaProvider } from './sina';
import { TencentProvider } from './tencent';

export interface ProviderMeta {
  id: string;
  label: string;
  hint?: string;
}

export interface FetchRange {
  begin?: string; // YYYY-MM-DD，不传则从最早可得数据开始
  end?: string;   // YYYY-MM-DD，不传则到最近交易日
}

export interface FetchResult {
  bars: Bar[];
  source: string;
  fetchedAt: number;
  name?: string;
  code?: string;
}

export interface HistoryProvider {
  readonly meta: ProviderMeta;
  fetchHistory(code: string, range: FetchRange): Promise<FetchResult>;
}

export interface FetchDraft {
  code: string;
  providerId: string;
  begin: string;
  end: string;
  target: 'current' | 'new';
}

export const PROVIDERS: Record<string, HistoryProvider> = {
  auto: new AutoProvider([new TencentProvider(), new EastmoneyProvider(), new SinaProvider()]),
  eastmoney: new EastmoneyProvider(),
  tencent: new TencentProvider(),
  sina: new SinaProvider(),
  mock: new MockProvider(),
};

export const PROVIDER_ORDER = ['auto', 'eastmoney', 'tencent', 'sina', 'mock'] as const;

export function getProvider(id: string): HistoryProvider {
  return PROVIDERS[id] ?? PROVIDERS.auto;
}

export { toSecid } from './eastmoney';
