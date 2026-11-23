import type { FetchRange, FetchResult, HistoryProvider, ProviderMeta } from './index';

/** 自动模式：按顺序尝试多个数据源，任意一个成功即返回
 *  单个接口被反爬、限流、临时挂掉时，不至于整个功能不可用。
 */
export class AutoProvider implements HistoryProvider {
  readonly meta: ProviderMeta = {
    id: 'auto',
    label: '自动（腾讯 → 东方财富 → 新浪）',
    hint: '依次尝试三个免费行情源，任一成功即写入；失败会列出每个数据源的具体原因',
  };

  constructor(private readonly chain: HistoryProvider[]) {}

  async fetchHistory(code: string, range: FetchRange): Promise<FetchResult> {
    const errors: string[] = [];
    for (const provider of this.chain) {
      try {
        const result = await provider.fetchHistory(code, range);
        if (result.bars.length) {
          return {
            ...result,
            source: errors.length ? `${result.source}（已回退）` : result.source,
          };
        }
        errors.push(`${provider.meta.label}：返回空数据`);
      } catch (e) {
        errors.push(`${provider.meta.label}：${(e as Error).message}`);
      }
    }
    throw new Error(`所有行情源均失败：\n${errors.join('\n')}`);
  }
}
