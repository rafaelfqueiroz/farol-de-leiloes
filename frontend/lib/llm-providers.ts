export type LLMProvider = 'ollama' | 'groq' | 'gemini' | 'openai' | 'anthropic';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

function getProviderConfigs(): Record<LLMProvider, LLMConfig> {
  return {
    ollama: {
      provider: 'ollama',
      model: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    },
    groq: {
      provider: 'groq',
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: process.env.GROQ_API_KEY,
    },
    gemini: {
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: process.env.GOOGLE_API_KEY,
    },
    openai: {
      provider: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY,
    },
    anthropic: {
      provider: 'anthropic',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  };
}

export function getLLMConfig(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || 'ollama') as LLMProvider;
  const configs = getProviderConfigs();

  if (!configs[provider]) {
    console.warn(`Unknown LLM provider: ${provider}, falling back to ollama`);
    return configs.ollama;
  }

  return configs[provider];
}

export function validateLLMConfig(config: LLMConfig): { valid: boolean; error?: string } {
  // Ollama doesn't need API key
  if (config.provider === 'ollama') {
    return { valid: true };
  }

  // Cloud providers need API key
  if (!config.apiKey) {
    const envVarName = {
      groq: 'GROQ_API_KEY',
      gemini: 'GOOGLE_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
    }[config.provider];

    return {
      valid: false,
      error: `Missing API key for ${config.provider}. Set ${envVarName} in .env.local`,
    };
  }

  return { valid: true };
}
