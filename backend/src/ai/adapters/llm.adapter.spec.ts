// TS-07: no LLM provider is called. `fetch` is stubbed (a platform global, TS-03) and the config
// is a Map-backed stand-in of ConfigService, so the spec sees exactly the request each provider
// would get and how each answer or failure is handled.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { LlmAdapter, type LlmConfig } from './llm.adapter.js';
import type { Env } from '../../config/env.js';

type Deps = ConstructorParameters<typeof LlmAdapter>;

function aAdapter(env: Record<string, string | undefined>) {
  const configService = { get: (key: string) => env[key] } as unknown as Deps[0] &
    ConfigService<Env, true>;
  return new LlmAdapter(configService);
}

const ENV = {
  LLM_PROVIDER: 'groq',
  OLLAMA_MODEL: 'llama3',
  OLLAMA_BASE_URL: 'http://ollama.test:11434/v1',
  GROQ_MODEL: 'groq-model',
  GROQ_API_KEY: 'groq-key',
  GEMINI_MODEL: 'gemini-model',
  GOOGLE_API_KEY: 'google-key',
  OPENAI_MODEL: 'openai-model',
  OPENAI_API_KEY: 'openai-key',
  ANTHROPIC_MODEL: 'claude-model',
  ANTHROPIC_API_KEY: 'anthropic-key',
};

const fetchStub = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
  fetchStub.mockReset();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** The URL and the parsed request of the first call to the stubbed fetch. */
function sentRequest() {
  const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
    method: init.method,
  };
}

describe('LlmAdapter.getConfig', () => {
  it.each([
    ['ollama', { model: 'llama3', baseUrl: 'http://ollama.test:11434/v1', apiKey: undefined }],
    [
      'groq',
      { model: 'groq-model', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'groq-key' },
    ],
    [
      'gemini',
      {
        model: 'gemini-model',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'google-key',
      },
    ],
    [
      'openai',
      { model: 'openai-model', baseUrl: 'https://api.openai.com/v1', apiKey: 'openai-key' },
    ],
    [
      'anthropic',
      { model: 'claude-model', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'anthropic-key' },
    ],
  ])('selects the %s settings for LLM_PROVIDER=%s', (provider, expected) => {
    const config = aAdapter({ ...ENV, LLM_PROVIDER: provider }).getConfig();

    expect(config).toEqual({ provider, ...expected });
  });
});

describe('LlmAdapter.validateConfig', () => {
  const base: LlmConfig = { provider: 'openai', model: 'm', baseUrl: 'https://x.test' };
  const adapter = aAdapter(ENV);

  it('needs no key for a local Ollama', () => {
    expect(adapter.validateConfig({ ...base, provider: 'ollama' })).toEqual({ valid: true });
  });

  it('accepts a cloud provider with a key', () => {
    expect(adapter.validateConfig({ ...base, apiKey: 'k' })).toEqual({ valid: true });
  });

  it.each([
    ['groq', 'GROQ_API_KEY'],
    ['gemini', 'GOOGLE_API_KEY'],
    ['openai', 'OPENAI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
  ] as const)('names the variable to set when the %s key is missing', (provider, variable) => {
    expect(adapter.validateConfig({ ...base, provider })).toEqual({
      valid: false,
      error: `Missing API key for ${provider}. Set ${variable} in environment`,
    });
  });
});

describe('LlmAdapter.chat with an OpenAI-compatible provider', () => {
  it('posts the system and user messages with the bearer key and returns the first choice', async () => {
    fetchStub.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'answer' } }] }));

    await expect(aAdapter(ENV).chat('be brief', 'hello')).resolves.toBe('answer');

    const sent = sentRequest();
    expect(sent.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(sent.method).toBe('POST');
    expect(sent.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer groq-key',
    });
    expect(sent.body).toEqual({
      model: 'groq-model',
      max_tokens: 256,
      temperature: 0,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ],
    });
  });

  it('sends no Authorization header to a local Ollama', async () => {
    fetchStub.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));

    await aAdapter({ ...ENV, LLM_PROVIDER: 'ollama' }).chat('s', 'u');

    expect(sentRequest().url).toBe('http://ollama.test:11434/v1/chat/completions');
    expect(sentRequest().headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('answers an empty string when the provider returns no choices', async () => {
    fetchStub.mockResolvedValue(jsonResponse({ choices: [] }));
    await expect(aAdapter(ENV).chat('s', 'u')).resolves.toBe('');
  });

  it('fails with the status and body when the provider answers an error', async () => {
    fetchStub.mockResolvedValue(new Response('rate limited', { status: 429 }));
    await expect(aAdapter(ENV).chat('s', 'u')).rejects.toThrow('LLM API error (429): rate limited');
  });

  it('fails before any request when the provider key is missing', async () => {
    await expect(
      aAdapter({ ...ENV, OPENAI_API_KEY: '', LLM_PROVIDER: 'openai' }).chat('s', 'u'),
    ).rejects.toThrow('Missing API key for openai. Set OPENAI_API_KEY in environment');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('LlmAdapter.chat with Anthropic', () => {
  const anthropic = { ...ENV, LLM_PROVIDER: 'anthropic' };

  it('posts to /messages with the version header and returns the first text block', async () => {
    fetchStub.mockResolvedValue(
      jsonResponse({
        content: [
          { type: 'tool_use' },
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      }),
    );

    await expect(aAdapter(anthropic).chat('be brief', 'hello')).resolves.toBe('first');

    const sent = sentRequest();
    expect(sent.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'anthropic-key',
      'anthropic-version': '2023-06-01',
    });
    expect(sent.body).toEqual({
      model: 'claude-model',
      max_tokens: 256,
      system: 'be brief',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('answers an empty string when there is no text block', async () => {
    fetchStub.mockResolvedValue(jsonResponse({ content: [{ type: 'tool_use' }] }));
    await expect(aAdapter(anthropic).chat('s', 'u')).resolves.toBe('');
  });

  it('answers an empty string for a text block without text', async () => {
    fetchStub.mockResolvedValue(jsonResponse({ content: [{ type: 'text' }] }));
    await expect(aAdapter(anthropic).chat('s', 'u')).resolves.toBe('');
  });

  it('fails with the status and body when Anthropic answers an error', async () => {
    fetchStub.mockResolvedValue(new Response('overloaded', { status: 529 }));
    await expect(aAdapter(anthropic).chat('s', 'u')).rejects.toThrow(
      'Anthropic API error (529): overloaded',
    );
  });
});
