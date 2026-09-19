import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { escapeTelegramHtml } from '@/lib/telegram';

/**
 * Telegram delivery tests.
 *
 * A real HTTP server stands in for the Bot API so nothing about fetch is mocked: the real
 * client makes real requests over loopback, including the local Bot API server override.
 */

interface Recorded {
  url: string;
  body: Record<string, unknown>;
}

let server: http.Server;
let port = 0;
let recorded: Recorded[] = [];
let respondWith: { status: number; body: unknown } = { status: 200, body: { ok: true, result: {} } };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      recorded.push({ url: req.url || '', body: raw ? JSON.parse(raw) : {} });
      res.writeHead(respondWith.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(respondWith.body));
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

const { sendTelegramMessage, getTelegramConfig, getTelegramMe, getTelegramUpdates, isTelegramConfigured } =
  await import('@/lib/telegram');

function configure(overrides: Record<string, string> = {}) {
  configValues = {
    TELEGRAM_BOT_TOKEN: '123456:TEST-TOKEN',
    TELEGRAM_STOCK_CHAT_ID: '-100111',
    TELEGRAM_CRYPTO_CHAT_ID: '-200222',
    TELEGRAM_API_BASE_URL: `http://127.0.0.1:${port}`,
    TELEGRAM_ENABLED: 'true',
    ...overrides,
  };
}

describe('escapeTelegramHtml', () => {
  it('escapes the three characters Telegram parses as markup', () => {
    expect(escapeTelegramHtml('AT&T')).toBe('AT&amp;T');
    expect(escapeTelegramHtml('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
    expect(escapeTelegramHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes the ampersand first, so it is not double-escaped', () => {
    // A naive order would turn "&lt;" into "&amp;lt;" and render the entity literally.
    expect(escapeTelegramHtml('&lt;')).toBe('&amp;lt;');
    expect(escapeTelegramHtml('&amp;')).toBe('&amp;amp;');
  });

  it('handles empty and non-string input', () => {
    expect(escapeTelegramHtml('')).toBe('');
    expect(escapeTelegramHtml(undefined as unknown as string)).toBe('');
  });
});

describe('audience routing', () => {
  afterEach(() => {
    recorded = [];
    respondWith = { status: 200, body: { ok: true, result: { message_id: 1 } } };
  });

  it('sends stock messages to the stock chat', async () => {
    configure();
    await sendTelegramMessage('stock message', { audience: 'stocks' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('/bot123456:TEST-TOKEN/sendMessage');
    expect(recorded[0].body.chat_id).toBe('-100111');
  });

  it('sends crypto messages to the crypto chat', async () => {
    configure();
    await sendTelegramMessage('crypto message', { audience: 'crypto' });

    expect(recorded[0].body.chat_id).toBe('-200222');
  });

  it('uses HTML parse mode and disables link previews', async () => {
    configure();
    await sendTelegramMessage('hello', { audience: 'stocks' });

    expect(recorded[0].body.parse_mode).toBe('HTML');
    expect(recorded[0].body.link_preview_options).toEqual({ is_disabled: true });
  });

  it('does not call Telegram when the audience chat is unset', async () => {
    configure({ TELEGRAM_CRYPTO_CHAT_ID: '' });
    const result = await sendTelegramMessage('x', { audience: 'crypto' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('crypto chat is not configured');
    expect(recorded).toHaveLength(0);
  });

  it('reports a Telegram error description verbatim', async () => {
    configure({ TELEGRAM_CRYPTO_CHAT_ID: 'wrong' });
    respondWith = { status: 400, body: { ok: false, description: 'Bad Request: chat not found' } };

    const result = await sendTelegramMessage('x', { audience: 'crypto' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Bad Request: chat not found');
  });

  it('returns the message id on success', async () => {
    configure();
    respondWith = { status: 200, body: { ok: true, result: { message_id: 42 } } };

    const result = await sendTelegramMessage('x', { audience: 'stocks' });
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe(42);
  });
});

describe('enable flag', () => {
  it('does not send when disabled, without clearing the token', async () => {
    configure({ TELEGRAM_ENABLED: 'false' });
    const config = await getTelegramConfig();
    expect(config.token).toBe('123456:TEST-TOKEN');
    expect(isTelegramConfigured(config)).toBe(false);

    const result = await sendTelegramMessage('x', { audience: 'stocks' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('disabled');
    expect(recorded).toHaveLength(0);

    configure();
  });
});

describe('getTelegramMe', () => {
  it('returns the bot username', async () => {
    configure();
    respondWith = { status: 200, body: { ok: true, result: { username: 'openstock_bot' } } };

    const result = await getTelegramMe();
    expect(result.ok).toBe(true);
    expect(result.username).toBe('openstock_bot');
  });

  it('surfaces an invalid token', async () => {
    configure();
    respondWith = { status: 401, body: { ok: false, description: 'Unauthorized' } };

    const result = await getTelegramMe();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });
});

describe('getTelegramUpdates', () => {
  it('lists distinct chats that have messaged the bot', async () => {
    configure();
    respondWith = {
      status: 200,
      body: {
        ok: true,
        result: [
          { message: { chat: { id: -100, title: 'Stock Alerts' } } },
          { message: { chat: { id: -200, first_name: 'Me' } } },
          // duplicate chat must not appear twice
          { message: { chat: { id: -100, title: 'Stock Alerts' } } },
          { message: { chat: { id: -300, username: 'cryptochat' } } },
        ],
      },
    };

    const result = await getTelegramUpdates();
    expect(result.ok).toBe(true);
    expect(result.chats).toHaveLength(3);
    expect(result.chats).toContainEqual({ id: '-100', label: 'Stock Alerts' });
    expect(result.chats).toContainEqual({ id: '-200', label: 'Me' });
    expect(result.chats).toContainEqual({ id: '-300', label: 'cryptochat' });
  });

  it('ignores updates with no chat', async () => {
    configure();
    respondWith = { status: 200, body: { ok: true, result: [{}, { message: {} }] } };

    const result = await getTelegramUpdates();
    expect(result.ok).toBe(true);
    expect(result.chats).toHaveLength(0);
  });
});
