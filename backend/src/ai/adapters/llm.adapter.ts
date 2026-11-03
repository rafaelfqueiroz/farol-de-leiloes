import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env, LlmProvider } from '../../config/env';

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

interface OpenAiCompatibleResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface AnthropicResponse {
  content: Array<{
    type: string;
    text?: string;
  }>;
}

@Injectable()
export class LlmAdapter {
  private readonly logger = new Logger(LlmAdapter.name);

  constructor(private readonly configService: ConfigService<Env, true>) {}

  // AR-41: provider, models and the selected provider's key are validated at boot; the defaults
  // live in the schema (src/config/env.schema.ts).
  getConfig(): LlmConfig {
    return this.getProviderConfigs()[this.configService.get('LLM_PROVIDER', { infer: true })];
  }

  private getProviderConfigs(): Record<LlmProvider, LlmConfig> {
    const get = <K extends keyof Env>(key: K): Env[K] =>
      this.configService.get(key, { infer: true });
    return {
      ollama: {
        provider: 'ollama',
        model: get('OLLAMA_MODEL'),
        baseUrl: get('OLLAMA_BASE_URL'),
      },
      groq: {
        provider: 'groq',
        model: get('GROQ_MODEL'),
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: get('GROQ_API_KEY'),
      },
      gemini: {
        provider: 'gemini',
        model: get('GEMINI_MODEL'),
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: get('GOOGLE_API_KEY'),
      },
      openai: {
        provider: 'openai',
        model: get('OPENAI_MODEL'),
        baseUrl: 'https://api.openai.com/v1',
        apiKey: get('OPENAI_API_KEY'),
      },
      anthropic: {
        provider: 'anthropic',
        model: get('ANTHROPIC_MODEL'),
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: get('ANTHROPIC_API_KEY'),
      },
    };
  }

  validateConfig(config: LlmConfig): { valid: boolean; error?: string } {
    // Ollama doesn't need API key
    if (config.provider === 'ollama') {
      return { valid: true };
    }

    // Cloud providers need API key
    if (!config.apiKey) {
      const envVarName: Record<LlmProvider, string> = {
        ollama: 'N/A',
        groq: 'GROQ_API_KEY',
        gemini: 'GOOGLE_API_KEY',
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
      };

      return {
        valid: false,
        error: `Missing API key for ${config.provider}. Set ${envVarName[config.provider]} in environment`,
      };
    }

    return { valid: true };
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const config = this.getConfig();

    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    this.logger.log(`Using LLM provider: ${config.provider} (model: ${config.model})`);

    if (config.provider === 'anthropic') {
      return this.callAnthropicApi(config, systemPrompt, userMessage);
    }

    return this.callOpenAiCompatibleApi(config, systemPrompt, userMessage);
  }

  private async callOpenAiCompatibleApi(
    config: LlmConfig,
    systemPrompt: string,
    userMessage: string,
  ): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        max_tokens: 256,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error (${response.status}): ${errorText}`);
    }

    const data: OpenAiCompatibleResponse = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  private async callAnthropicApi(
    config: LlmConfig,
    systemPrompt: string,
    userMessage: string,
  ): Promise<string> {
    const response = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
    }

    const data: AnthropicResponse = await response.json();
    const textContent = data.content.find((block) => block.type === 'text');
    return textContent?.text || '';
  }
}
