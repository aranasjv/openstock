import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatCryptoSymbolForTradingView, cryptoTradingViewCandidates } from '@/lib/utils';
import { resolveCryptoTradingViewSymbol, verifyTradingViewSymbol } from '@/lib/tradingview';

/**
 * Regression tests for the crypto TradingView symbol.
 *
 * The original implementation keyed a map on the CoinGecko *id* and fell back to
 * `CRYPTO:${ID}USD`. Both halves were wrong: `CRYPTO:` is not a real venue prefix
 * (CRYPTO:TAOUSD is a 404), and the id is not a tradable symbol — which is why
 * /crypto/bittensor rendered "Invalid Symbol".
 */
describe('formatCryptoSymbolForTradingView', () => {
  it('uses the ticker against a real exchange', () => {
    // CoinGecko id is "bittensor"; the ticker is TAO.
    expect(formatCryptoSymbolForTradingView('TAO')).toBe('BINANCE:TAOUSDT');
  });

  it('accepts lower or mixed case tickers', () => {
    expect(formatCryptoSymbolForTradingView('tao')).toBe('BINANCE:TAOUSDT');
    expect(formatCryptoSymbolForTradingView('Btc')).toBe('BINANCE:BTCUSDT');
    expect(formatCryptoSymbolForTradingView(' arb ')).toBe('BINANCE:ARBUSDT');
  });

  it('never emits the CRYPTO: prefix, which does not resolve', () => {
    for (const ticker of ['TAO', 'BTC', 'ARB', 'MKR', 'RENDER']) {
      expect(formatCryptoSymbolForTradingView(ticker)).not.toContain('CRYPTO:');
    }
  });

  it('never emits a CoinGecko id as the symbol', () => {
    // Passing an id would produce BINANCE:BITTENSORUSDT, which does not exist.
    const asId = formatCryptoSymbolForTradingView('bittensor');
    expect(asId).toBe('BINANCE:BITTENSORUSDT');
    // Documented consequence: ids are not tickers, so callers must resolve the ticker
    // first. This test exists to make that contract explicit.
    expect(asId).not.toBe('BINANCE:TAOUSDT');
  });

  it('returns null for empty or junk input so charts can be skipped', () => {
    expect(formatCryptoSymbolForTradingView('')).toBeNull();
    expect(formatCryptoSymbolForTradingView('   ')).toBeNull();
    expect(formatCryptoSymbolForTradingView('../etc/passwd')).toBeNull();
    expect(formatCryptoSymbolForTradingView('a'.repeat(20))).toBeNull();
  });

  it('has no chart for a stablecoin that has no meaningful pair', () => {
    expect(formatCryptoSymbolForTradingView('USDT')).toBeNull();
    expect(formatCryptoSymbolForTradingView('usdt')).toBeNull();
  });

  it('applies the Binance USDT convention to every other ticker', () => {
    expect(formatCryptoSymbolForTradingView('USDC')).toBe('BINANCE:USDCUSDT');
    expect(formatCryptoSymbolForTradingView('DOGE')).toBe('BINANCE:DOGEUSDT');
    expect(formatCryptoSymbolForTradingView('SHIB')).toBe('BINANCE:SHIBUSDT');
  });
});

describe('cryptoTradingViewCandidates', () => {
  it('offers several venues, best guess first', () => {
    const candidates = cryptoTradingViewCandidates('TAO');
    expect(candidates[0]).toBe('BINANCE:TAOUSDT');
    expect(candidates).toContain('COINBASE:TAOUSD');
    expect(candidates.length).toBeGreaterThan(3);
  });

  it('never offers a CRYPTO: symbol, which does not resolve', () => {
    expect(cryptoTradingViewCandidates('TAO').some((c) => c.startsWith('CRYPTO:'))).toBe(false);
  });

  it('returns nothing for junk input or a stablecoin', () => {
    expect(cryptoTradingViewCandidates('')).toEqual([]);
    expect(cryptoTradingViewCandidates('../etc')).toEqual([]);
    expect(cryptoTradingViewCandidates('USDT')).toEqual([]);
  });
});

describe('verified TradingView resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The scanner endpoint answers "does this symbol exist": 200 with data, 404 with
   * symbol_not_exists. These tests pin that contract, because the whole point of this layer
   * is to stop guessing at symbol formats.
   */
  const respond = (okFor: (url: string) => boolean) =>
    vi.fn().mockImplementation((url: string) => {
      const symbol = decodeURIComponent(String(url).split('symbol=')[1]?.split('&')[0] ?? '');
      return Promise.resolve(okFor(symbol) ? { ok: true } : { ok: false, status: 404 });
    });

  it('returns the first candidate that exists', async () => {
    vi.stubGlobal('fetch', respond((symbol) => symbol === 'BINANCE:TAOUSDT'));
    expect(await resolveCryptoTradingViewSymbol('TAO')).toBe('BINANCE:TAOUSDT');
  });

  it('falls through to another venue when Binance does not list the coin', async () => {
    // This is the "missing ticker" case: Binance has no such pair, so a Binance-only rule
    // would have produced an invalid chart.
    vi.stubGlobal('fetch', respond((symbol) => symbol === 'MEXC:OBSCUREUSDT'));
    expect(await resolveCryptoTradingViewSymbol('OBSCURE')).toBe('MEXC:OBSCUREUSDT');
  });

  it('returns null when no venue lists the coin, so the chart can be hidden', async () => {
    vi.stubGlobal('fetch', respond(() => false));
    expect(await resolveCryptoTradingViewSymbol('NOTREAL')).toBeNull();
  });

  it('does not probe at all for a ticker that cannot form a symbol', async () => {
    const mock = respond(() => true);
    vi.stubGlobal('fetch', mock);
    expect(await resolveCryptoTradingViewSymbol('USDT')).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it('reports a probe as not-verified when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await verifyTradingViewSymbol('BINANCE:BTCUSDT')).toBe(false);
    spy.mockRestore();
  });
});
