import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getProviderConfig,
  getFallbackProviderName,
  callAIProvider,
  callAIProviderWithFallback,
  type AIProviderName,
} from "@/lib/ai-provider";

/**
 * Replace the config layer's database read with an env-only read built from the real
 * schema. This keeps the tests hermetic (they never touch MongoDB or real saved settings)
 * without duplicating key names or defaults, which would drift from the schema.
 */
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    loadConfig: async () => {
      const values: Record<string, string> = {};
      for (const def of actual.CONFIG_SCHEMA) {
        let value: string | undefined;
        for (const name of def.env ?? []) {
          if (process.env[name]) {
            value = process.env[name];
            break;
          }
        }
        values[def.key] = value ?? def.default ?? "";
      }
      return values;
    },
  };
});

// ── getProviderConfig ──────────────────────────────────────────────

describe("getProviderConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to gemini when no env var is set", async () => {
    delete process.env.AI_PROVIDER;
    const config = await getProviderConfig();
    expect(config.name).toBe("gemini");
    expect(config.baseUrl).toContain("generativelanguage.googleapis.com");
    expect(config.model).toBe("gemini-2.5-flash-lite");
  });

  it("returns deepseek config with OpenAI-compatible defaults", async () => {
    process.env.DEEPSEEK_API_KEY = "ds-key";
    const config = await getProviderConfig("deepseek");
    expect(config.name).toBe("deepseek");
    expect(config.baseUrl).toBe("https://api.deepseek.com");
    expect(config.model).toBe("deepseek-flash");
    expect(config.apiKey).toBe("ds-key");
  });

  it("respects DEEPSEEK_MODEL and DEEPSEEK_BASE_URL env vars", async () => {
    process.env.DEEPSEEK_API_KEY = "ds-key";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
    process.env.DEEPSEEK_BASE_URL = "https://custom.deepseek.example";
    const config = await getProviderConfig("deepseek");
    expect(config.model).toBe("deepseek-v4-pro");
    expect(config.baseUrl).toBe("https://custom.deepseek.example");
  });

  it("returns minimax config when provider is minimax", async () => {
    process.env.MINIMAX_API_KEY = "test-key";
    const config = await getProviderConfig("minimax");
    expect(config.name).toBe("minimax");
    expect(config.baseUrl).toBe("https://api.minimax.io/v1");
    expect(config.model).toBe("MiniMax-M3");
    expect(config.apiKey).toBe("test-key");
  });

  it("respects MINIMAX_MODEL env var", async () => {
    process.env.MINIMAX_MODEL = "MiniMax-M2.5-highspeed";
    const config = await getProviderConfig("minimax");
    expect(config.model).toBe("MiniMax-M2.5-highspeed");
  });

  it("respects MINIMAX_BASE_URL env var", async () => {
    process.env.MINIMAX_BASE_URL = "https://custom.minimax.example/v1";
    const config = await getProviderConfig("minimax");
    expect(config.baseUrl).toBe("https://custom.minimax.example/v1");
  });

  it("returns siray config when provider is siray", async () => {
    process.env.SIRAY_API_KEY = "siray-key";
    const config = await getProviderConfig("siray");
    expect(config.name).toBe("siray");
    expect(config.baseUrl).toBe("https://api.siray.ai/v1");
    expect(config.model).toBe("siray-1.0-ultra");
    expect(config.apiKey).toBe("siray-key");
  });

  it("reads AI_PROVIDER from env when no argument is given", async () => {
    process.env.AI_PROVIDER = "minimax";
    process.env.MINIMAX_API_KEY = "k";
    const config = await getProviderConfig();
    expect(config.name).toBe("minimax");
  });

  it("reads a deepseek provider from AI_PROVIDER", async () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "k";
    const config = await getProviderConfig();
    expect(config.name).toBe("deepseek");
  });

  it("respects GEMINI_MODEL env var", async () => {
    process.env.GEMINI_MODEL = "gemini-2.0-flash";
    const config = await getProviderConfig("gemini");
    expect(config.model).toBe("gemini-2.0-flash");
  });
});

// ── getFallbackProviderName ────────────────────────────────────────

describe("getFallbackProviderName", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("prefers deepseek when primary is gemini and a deepseek key is set", async () => {
    process.env.DEEPSEEK_API_KEY = "d";
    expect(await getFallbackProviderName("gemini")).toBe("deepseek");
  });

  it("returns minimax when primary is gemini and only MINIMAX_API_KEY is set", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.MINIMAX_API_KEY = "k";
    expect(await getFallbackProviderName("gemini")).toBe("minimax");
  });

  it("returns siray when primary is gemini and only SIRAY_API_KEY is set", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    process.env.SIRAY_API_KEY = "s";
    expect(await getFallbackProviderName("gemini")).toBe("siray");
  });

  it("returns gemini when primary is minimax", async () => {
    expect(await getFallbackProviderName("minimax")).toBe("gemini");
  });

  it("returns gemini when primary is siray", async () => {
    expect(await getFallbackProviderName("siray")).toBe("gemini");
  });

  it("returns gemini when primary is deepseek", async () => {
    expect(await getFallbackProviderName("deepseek")).toBe("gemini");
  });
});

// ── callAIProvider ─────────────────────────────────────────────────

describe("callAIProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when GEMINI_API_KEY is missing for gemini provider", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(callAIProvider("hello", "gemini")).rejects.toThrow(
      "GEMINI_API_KEY is not set"
    );
  });

  it("throws when DEEPSEEK_API_KEY is missing for deepseek provider", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(callAIProvider("hello", "deepseek")).rejects.toThrow(
      "DEEPSEEK_API_KEY is not set"
    );
  });

  it("throws when MINIMAX_API_KEY is missing for minimax provider", async () => {
    delete process.env.MINIMAX_API_KEY;
    await expect(callAIProvider("hello", "minimax")).rejects.toThrow(
      "MINIMAX_API_KEY is not set"
    );
  });

  it("throws when SIRAY_API_KEY is missing for siray provider", async () => {
    delete process.env.SIRAY_API_KEY;
    await expect(callAIProvider("hello", "siray")).rejects.toThrow(
      "SIRAY_API_KEY is not set"
    );
  });

  it("calls Gemini API with correct format", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [
            { content: { parts: [{ text: "Hello from Gemini" }] } },
          ],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await callAIProvider("test prompt", "gemini");
    expect(result).toBe("Hello from Gemini");

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("key=test-gemini-key");
    const body = JSON.parse(options.body);
    expect(body.contents[0].parts[0].text).toBe("test prompt");
  });

  it("calls DeepSeek with the OpenAI-compatible format", async () => {
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "Hello from DeepSeek" } }],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await callAIProvider("test prompt", "deepseek");
    expect(result).toBe("Hello from DeepSeek");

    const [url, options] = mockFetch.mock.calls[0];
    // DeepSeek's OpenAI-compatible base URL already excludes /v1.
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(options.headers["Authorization"]).toBe("Bearer test-deepseek-key");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("deepseek-flash");
    expect(body.messages[0].content).toBe("test prompt");
    expect(body.temperature).toBe(0.7);
  });

  it("calls MiniMax API with OpenAI-compatible format", async () => {
    process.env.MINIMAX_API_KEY = "test-minimax-key";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "Hello from MiniMax" } }],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await callAIProvider("test prompt", "minimax");
    expect(result).toBe("Hello from MiniMax");

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.minimax.io/v1/chat/completions");
    expect(options.headers["Authorization"]).toBe(
      "Bearer test-minimax-key"
    );
    const body = JSON.parse(options.body);
    expect(body.model).toBe("MiniMax-M3");
    expect(body.messages[0].content).toBe("test prompt");
    expect(body.temperature).toBe(0.7);
  });

  it("calls Siray API with OpenAI-compatible format", async () => {
    process.env.SIRAY_API_KEY = "test-siray-key";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "Hello from Siray" } }],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await callAIProvider("test prompt", "siray");
    expect(result).toBe("Hello from Siray");

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.siray.ai/v1/chat/completions");
    expect(options.headers["Authorization"]).toBe("Bearer test-siray-key");
  });

  it("throws on API error response", async () => {
    process.env.GEMINI_API_KEY = "k";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      })
    );

    await expect(callAIProvider("hello", "gemini")).rejects.toThrow(
      "Gemini API error: 429"
    );
  });

  it("throws on empty Gemini response", async () => {
    process.env.GEMINI_API_KEY = "k";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ candidates: [] }),
      })
    );

    await expect(callAIProvider("hello", "gemini")).rejects.toThrow(
      "Gemini returned empty response"
    );
  });

  it("throws on empty MiniMax response", async () => {
    process.env.MINIMAX_API_KEY = "k";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: {} }] }),
      })
    );

    await expect(callAIProvider("hello", "minimax")).rejects.toThrow(
      "minimax returned empty response"
    );
  });
});

// ── callAIProviderWithFallback ─────────────────────────────────────

describe("callAIProviderWithFallback", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns primary provider result on success", async () => {
    process.env.AI_PROVIDER = "minimax";
    process.env.MINIMAX_API_KEY = "k";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "MiniMax response" } }],
          }),
      })
    );

    const result = await callAIProviderWithFallback("test");
    expect(result).toBe("MiniMax response");
  });

  it("falls back to secondary provider on primary failure", async () => {
    process.env.AI_PROVIDER = "minimax";
    process.env.MINIMAX_API_KEY = "k";
    process.env.GEMINI_API_KEY = "g";

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes("minimax")) {
          return Promise.resolve({ ok: false, status: 500, statusText: "Error" });
        }
        // Gemini fallback
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              candidates: [
                { content: { parts: [{ text: "Gemini fallback" }] } },
              ],
            }),
        });
      })
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await callAIProviderWithFallback("test");
    expect(result).toBe("Gemini fallback");
    expect(callCount).toBe(2);
    consoleSpy.mockRestore();
  });

  it("uses gemini as default primary and minimax as fallback", async () => {
    delete process.env.AI_PROVIDER;
    process.env.GEMINI_API_KEY = "g";
    process.env.MINIMAX_API_KEY = "m";

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes("googleapis")) {
          return Promise.resolve({ ok: false, status: 500, statusText: "Error" });
        }
        // MiniMax fallback
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: "MiniMax fallback" } }],
            }),
        });
      })
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await callAIProviderWithFallback("test");
    expect(result).toBe("MiniMax fallback");
    expect(callCount).toBe(2);
    consoleSpy.mockRestore();
  });

  it("falls back to deepseek when it is the only configured alternative", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "g";
    process.env.DEEPSEEK_API_KEY = "d";

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes("googleapis")) {
          return Promise.resolve({ ok: false, status: 500, statusText: "Error" });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: "DeepSeek fallback" } }],
            }),
        });
      })
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await callAIProviderWithFallback("test");
    expect(result).toBe("DeepSeek fallback");
    expect(callCount).toBe(2);
    consoleSpy.mockRestore();
  });

  it("throws when both primary and fallback fail", async () => {
    process.env.AI_PROVIDER = "minimax";
    process.env.MINIMAX_API_KEY = "k";
    process.env.GEMINI_API_KEY = "g";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(callAIProviderWithFallback("test")).rejects.toThrow();
    consoleSpy.mockRestore();
  });
});
