import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { getTraderFramework } from '@/lib/trading-framework';

/**
 * End-to-end HTTP test for the provider layer.
 *
 * Unlike the unit tests, nothing about fetch is mocked: a real HTTP server stands in for
 * the model endpoint and the real callAIProvider makes a real request over the loopback
 * interface. This closes the last gap in the chain —
 *
 *   framework selected in settings -> options.system -> request body -> wire
 *
 * — which otherwise is only proven by two separate mocked assertions.
 */

interface Recorded {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

let server: http.Server;
let port = 0;
let recorded: Recorded | null = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      recorded = {
        url: req.url || '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : {},
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Setup: ok.' } }] }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      port = typeof address === 'object' && address ? address.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let configValues: Record<string, string> = {};

vi.mock('@/lib/config', () => ({
  loadConfig: async () => configValues,
}));

// Imported after the mock is registered.
const { callAIProvider } = await import('@/lib/ai-provider');

describe('callAIProvider over real HTTP', () => {
  afterEach(() => {
    recorded = null;
  });

  it('delivers the framework system prompt and the figures to the endpoint', async () => {
    configValues = {
      AI_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}`,
      DEEPSEEK_MODEL: 'deepseek-flash',
    };

    const framework = getTraderFramework('technical-analyst');
    const result = await callAIProvider('RSI(14): 62.0', 'deepseek', {
      system: framework.system,
      temperature: framework.temperature,
    });

    expect(result).toBe('Setup: ok.');
    expect(recorded).not.toBeNull();

    // Correct endpoint and auth.
    expect(recorded!.url).toBe('/chat/completions');
    expect(recorded!.headers.authorization).toBe('Bearer test-key');

    // The framework arrived intact as the system message.
    const messages = recorded!.body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe(framework.system);

    // The anti-advice and invalidation requirements survived serialisation.
    expect(messages[0].content).toContain('NOT permitted to give investment advice');
    expect(messages[0].content).toContain('Invalidation:');

    expect(messages[1]).toEqual({ role: 'user', content: 'RSI(14): 62.0' });
    expect(recorded!.body.model).toBe('deepseek-flash');
    expect(recorded!.body.temperature).toBe(framework.temperature);
  });

  it('sends no system message when the plain request omits one', async () => {
    configValues = {
      AI_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}`,
    };

    await callAIProvider('bare prompt', 'deepseek');

    const messages = recorded!.body.messages as { role: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });

  it('surfaces a non-2xx response as an error', async () => {
    const errorServer = http.createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorised' }));
    });

    const errorPort = await new Promise<number>((resolve) => {
      errorServer.listen(0, '127.0.0.1', () => {
        const address = errorServer.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    configValues = {
      AI_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'bad-key',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${errorPort}`,
    };

    await expect(callAIProvider('x', 'deepseek')).rejects.toThrow('deepseek API error: 401');

    await new Promise<void>((resolve) => errorServer.close(() => resolve()));
  });
});
