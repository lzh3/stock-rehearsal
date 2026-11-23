export type AiProviderId = 'openai-compatible' | 'deepseek' | 'dashscope' | 'ollama' | 'custom';

export interface AiConfig {
  stockId: string;
  /** OpenAI 兼容的 chat completions 端点，如 https://api.deepseek.com/v1 */
  baseUrl: string;
  model: string;
  /** 留空则由用户稍后填写；绝不写入仓库或导出文件 */
  apiKey: string;
  temperature: number;
  /** 单次分析最多输出的条数 */
  updatedAt: number;
}

export const AI_DEFAULTS: Omit<AiConfig, 'stockId' | 'updatedAt'> = {
  baseUrl: 'https://api.siliconflow.com/v1',
  model: 'Qwen/Qwen3-14B',
  apiKey: 'sk-yutmesokvoxidpltrfjctlticyrxkqmfhhzdehcinnrvegue',
  temperature: 0.3,
};

export interface AiPreset {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  model: string;
  hint: string;
}

export const AI_PRESETS: AiPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: '便宜、支持中文、OpenAI 兼容；需要 api.deepseek.com 的 Key',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '标准 OpenAI 接口，浏览器直连可能被 CORS 拦截，建议走自己的代理',
  },
  {
    id: 'dashscope',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: '阿里云百炼兼容模式，国内访问稳定',
  },
  {
    id: 'ollama',
    label: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5',
    hint: '完全离线（模型需先 pull），apiKey 可随意填',
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    model: '',
    hint: '任何 OpenAI 兼容的 /chat/completions 接口',
  },
];

/** AI 返回的结构化结论 */
export interface AiInsight {
  /** 一句话结论，如「短线偏强但量能不足，追高性价比一般」 */
  headline: string;
  /** 倾向：偏多 / 偏空 / 中性 */
  stance: '偏多' | '偏空' | '中性';
  /** 置信度：低 / 中 / 高 */
  confidence: '低' | '中' | '高';
  /** 2~3 条要点 */
  points: string[];
  /** 1 条主要风险 */
  risks: string[];
  /** 关注的时间维度，如「1~5 个交易日」 */
  horizon: string;
  createdAt: number;
  model: string;
}
