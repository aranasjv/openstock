import { describe, it, expect } from 'vitest';
import { formatCryptoSymbolForTradingView } from '@/lib/utils';

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
