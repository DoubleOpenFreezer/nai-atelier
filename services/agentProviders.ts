import type { PromptAgentCustomApi } from './promptAgent';

/** 内置第三方提供商预设：选一个、填 Key 即可连接，无需手填地址与协议。 */
export interface AgentProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  api: PromptAgentCustomApi;
}

export const AGENT_PROVIDER_PRESETS: AgentProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', api: 'openai-completions' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages' },
  { id: 'google', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', api: 'openai-completions' },
  { id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1', api: 'openai-completions' },
  { id: 'moonshotai-cn', name: 'Kimi（中国）', baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions' },
  { id: 'moonshotai', name: 'Moonshot AI（国际）', baseUrl: 'https://api.moonshot.ai/v1', api: 'openai-completions' },
  { id: 'kimi-coding', name: 'Kimi For Coding', baseUrl: 'https://api.kimi.com/coding', api: 'anthropic-messages' },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.io/anthropic', api: 'anthropic-messages' },
  { id: 'minimax-cn', name: 'MiniMax（中国）', baseUrl: 'https://api.minimaxi.com/anthropic', api: 'anthropic-messages' },
  { id: 'zai', name: 'Z.AI', baseUrl: 'https://api.z.ai/api/coding/paas/v4', api: 'openai-completions' },
  { id: 'zai-coding-cn', name: 'Z.AI（中国）', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', api: 'openai-completions' },
  { id: 'xiaomi', name: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', api: 'openai-completions' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', api: 'openai-completions' },
  { id: 'together', name: 'Together', baseUrl: 'https://api.together.ai/v1', api: 'openai-completions' },
  { id: 'fireworks', name: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', api: 'openai-completions' },
  { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', api: 'openai-completions' },
  { id: 'nvidia', name: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1', api: 'openai-completions' },
  { id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1', api: 'openai-completions' },
  { id: 'vercel-ai-gateway', name: 'Vercel AI Gateway', baseUrl: 'https://ai-gateway.vercel.sh', api: 'anthropic-messages' },
  { id: 'ant-ling', name: 'Ant Ling', baseUrl: 'https://api.ant-ling.com/v1', api: 'openai-completions' },
  { id: 'opencode', name: 'OpenCode Zen', baseUrl: 'https://opencode.ai/zen/v1', api: 'openai-completions' },
  { id: 'opencode-go', name: 'OpenCode Zen Go', baseUrl: 'https://opencode.ai/zen/go/v1', api: 'openai-completions' },
  { id: 'qwen-token-plan', name: 'Qwen Token Plan', baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', api: 'openai-completions' },
  { id: 'qwen-token-plan-cn', name: 'Qwen Token Plan（中国）', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', api: 'openai-completions' },
  { id: 'xiaomi-token-plan-ams', name: '小米 Token Plan AMS', baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1', api: 'openai-completions' },
  { id: 'xiaomi-token-plan-cn', name: '小米 Token Plan（中国）', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', api: 'openai-completions' },
  { id: 'xiaomi-token-plan-sgp', name: '小米 Token Plan SGP', baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1', api: 'openai-completions' },
];
