import { describe, it, expect } from 'vitest';
import { buildDigestMessages, buildAlertMessage, type DigestInput } from '@/lib/notifications';

const baseInput: DigestInput = {
  date: '2026-09-19',
  strategyName: 'Trend Following',
  stockPicks: [
    { symbol: 'AAPL', name: 'Apple Inc.', score: 100, price: 336.13, isCrypto: false },
    { symbol: 'MSFT', name: 'Microsoft', score: 67, price: 512.4, isCrypto: false },
  ],
  cryptoPicks: [{ symbol: 'bitcoin', name: 'Bitcoin (BTC)', score: 67, price: 81304, isCrypto: true }],
  holdings: [
    { symbol: 'AAPL', quantity: 10, pnlPercent: 34.5, marketValue: 3361.3 },
    { symbol: 'bitcoin', quantity: 0.5, pnlPercent: -12.2, marketValue: 40652 },
  ],
  totalValue: 44013.3,
  totalPnlPercent: 18.7,
};

describe('buildDigestMessages', () => {
  it('produces a stock message and a crypto message', () => {
    const { stocks, crypto } = buildDigestMessages(baseInput);
    expect(stocks).toContain('Stocks');
    expect(stocks).toContain('Apple Inc.');
    expect(crypto).toContain('Crypto');
    expect(crypto).toContain('Bitcoin');
  });

  it('puts holdings only in the crypto message, so they are sent once', () => {
    // Both messages go out on every run; duplicating holdings would double-report the portfolio.
    const { stocks, crypto } = buildDigestMessages(baseInput);
    expect(crypto).toContain('Holdings');
    expect(stocks).not.toContain('Holdings');
  });

  it('always includes the not-advice disclaimer in both messages', () => {
    const { stocks, crypto } = buildDigestMessages(baseInput);
    expect(stocks).toContain('not investment advice');
    expect(crypto).toContain('not investment advice');
  });

  it('renders the score and price for each pick', () => {
    const { stocks } = buildDigestMessages(baseInput);
    expect(stocks).toContain('100');
    expect(stocks).toContain('336.13');
  });

  it('says so plainly when a market has no matches', () => {
    const { crypto } = buildDigestMessages({ ...baseInput, cryptoPicks: [] });
    expect(crypto).toContain('No matches right now.');
  });

  it('reports an empty portfolio rather than an empty section', () => {
    const { crypto } = buildDigestMessages({ ...baseInput, holdings: [], totalValue: 0, totalPnlPercent: 0 });
    expect(crypto).toContain('No holdings tracked yet.');
  });

  it('escapes HTML in names, which Telegram would otherwise reject', () => {
    const { stocks } = buildDigestMessages({
      ...baseInput,
      stockPicks: [{ symbol: 'T', name: 'AT&T <Holdings>', score: 100, price: 20, isCrypto: false }],
    });
    expect(stocks).toContain('AT&amp;T &lt;Holdings&gt;');
    expect(stocks).not.toContain('AT&T <Holdings>');
  });

  it('escapes the strategy name too', () => {
    const { stocks } = buildDigestMessages({ ...baseInput, strategyName: 'A & B' });
    expect(stocks).toContain('A &amp; B');
  });

  it('shows a negative holding P&L with its sign', () => {
    const { crypto } = buildDigestMessages(baseInput);
    expect(crypto).toContain('-12.2%');
  });

  it('renders n/a when a holding P&L could not be computed', () => {
    const { crypto } = buildDigestMessages({
      ...baseInput,
      holdings: [{ symbol: 'XYZ', quantity: 1, pnlPercent: null, marketValue: null }],
    });
    expect(crypto).toContain('n/a');
  });

  // Regression: commentary used to be appended to the crypto message only, so a caller
  // passing it saw it silently dropped from the stocks chat.
  it('includes optional commentary in both messages when provided', () => {
    const withCommentary = buildDigestMessages({ ...baseInput, commentary: 'Breadth is improving.' });
    const without = buildDigestMessages(baseInput);

    expect(withCommentary.crypto).toContain('Breadth is improving.');
    expect(withCommentary.stocks).toContain('Breadth is improving.');

    expect(without.crypto).not.toContain('Breadth is improving.');
    expect(without.stocks).not.toContain('Breadth is improving.');
  });
});

describe('buildAlertMessage', () => {
  it('returns null when nothing triggered, so no empty message is sent', () => {
    expect(buildAlertMessage([])).toBeNull();
  });

  it('describes an upward cross', () => {
    const message = buildAlertMessage([
      { symbol: 'AAPL', condition: 'ABOVE', targetPrice: 300, currentPrice: 336.13, isCrypto: false },
    ]);
    expect(message).toContain('AAPL');
    expect(message).toContain('above');
    expect(message).toContain('336.13');
  });

  it('describes a downward cross', () => {
    const message = buildAlertMessage([
      { symbol: 'BTC', condition: 'BELOW', targetPrice: 80000, currentPrice: 78000, isCrypto: true },
    ]);
    expect(message).toContain('below');
  });

  it('combines several alerts into one message to respect rate limits', () => {
    const message = buildAlertMessage([
      { symbol: 'AAPL', condition: 'ABOVE', targetPrice: 300, currentPrice: 336, isCrypto: false },
      { symbol: 'MSFT', condition: 'ABOVE', targetPrice: 500, currentPrice: 512, isCrypto: false },
    ]);
    expect(message).toContain('AAPL');
    expect(message).toContain('MSFT');
    // One message, not one per alert.
    expect(message!.split('\n')).toHaveLength(3);
  });
});
