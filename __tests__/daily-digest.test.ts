import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The daily digest is the app's one outbound job that nobody watches happen. It sends at a fixed
 * hour to chats the user may not read for days, so the failures that matter are the quiet ones:
 * the wrong audience being messaged, a market silently dropped, or a send failing while the
 * result still reports success.
 *
 * buildDigestMessages is mocked on purpose — its rendering is covered by notifications.test.ts.
 * What is asserted here is the job's own logic: which candidates survive the filter, which
 * audience receives what, and how partial failure is reported.
 */
const runScreener = vi.fn();
const getAdminUserId = vi.fn();
const getPortfolioSummaryForUser = vi.fn();
const sendTelegramMessage = vi.fn();
const getTelegramConfig = vi.fn();
const buildDigestMessages = vi.fn();

let configValues: Record<string, string> = {};

vi.mock('@/lib/config', () => ({ loadConfig: async () => configValues }));
vi.mock('@/lib/admin', () => ({ getAdminUserId: () => getAdminUserId() }));
vi.mock('@/lib/actions/screener.actions', () => ({
    runScreener: (assetType: string, strategy?: string) => runScreener(assetType, strategy),
}));
vi.mock('@/lib/data/portfolio', () => ({
    getPortfolioSummaryForUser: (userId: string) => getPortfolioSummaryForUser(userId),
}));
vi.mock('@/lib/telegram', () => ({
    getTelegramConfig: () => getTelegramConfig(),
    sendTelegramMessage: (text: string, options: unknown) => sendTelegramMessage(text, options),
}));
vi.mock('@/lib/notifications', () => ({
    buildDigestMessages: (input: unknown) => buildDigestMessages(input),
}));

import { runDailyDigest } from '@/lib/jobs/daily-digest';

interface Candidate {
    symbol: string;
    name: string;
    score: number;
    price: number;
    matched: number;
}

function screenerResult(candidates: Candidate[]) {
    return {
        strategyId: 'trend-following',
        strategies: [],
        candidates,
        scanned: candidates.length,
        unavailable: 0,
        degraded: false,
    };
}

function candidate(symbol: string, matched = 3): Candidate {
    return { symbol, name: symbol, score: 90, price: 10, matched };
}

beforeEach(() => {
    runScreener.mockReset();
    getAdminUserId.mockReset();
    getPortfolioSummaryForUser.mockReset();
    sendTelegramMessage.mockReset();
    getTelegramConfig.mockReset();
    buildDigestMessages.mockReset();

    configValues = { SCREENER_STRATEGY: 'trend-following', DIGEST_MARKET: 'both' };
    getAdminUserId.mockResolvedValue('admin-1');
    getPortfolioSummaryForUser.mockResolvedValue({
        holdings: [],
        totalValue: 0,
        totalPnlPercent: 0,
        unpricedSymbols: [],
        totalCost: 0,
        totalPnl: 0,
    });
    getTelegramConfig.mockResolvedValue({ enabled: true });
    sendTelegramMessage.mockResolvedValue({ ok: true, messageId: 1 });
    buildDigestMessages.mockReturnValue({ stocks: 'stocks-message', crypto: 'crypto-message' });

    runScreener.mockImplementation(async (assetType: string) =>
        screenerResult([candidate(assetType === 'crypto' ? 'bitcoin' : 'AAPL')])
    );
});

describe('runDailyDigest', () => {
    it('sends each market to its own chat', async () => {
        const result = await runDailyDigest();

        expect(result.ok).toBe(true);
        expect(result.sent).toEqual({ stocks: true, crypto: true });
        expect(sendTelegramMessage).toHaveBeenCalledTimes(2);
        expect(sendTelegramMessage.mock.calls.map((call) => call[1].audience)).toEqual([
            'stocks',
            'crypto',
        ]);
        expect(sendTelegramMessage.mock.calls[0][0]).toBe('stocks-message');
        expect(sendTelegramMessage.mock.calls[1][0]).toBe('crypto-message');
    });

    it('only scans and sends for the configured market', async () => {
        configValues.DIGEST_MARKET = 'crypto';

        const result = await runDailyDigest();

        // A stock scan here would spend a screener pass on a market nobody asked for.
        expect(runScreener).toHaveBeenCalledTimes(1);
        expect(runScreener).toHaveBeenCalledWith('crypto', 'trend-following');
        expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
        expect(sendTelegramMessage.mock.calls[0][1].audience).toBe('crypto');
        expect(result.sent).toEqual({ stocks: false, crypto: true });
    });

    it('drops candidates that matched nothing and caps the list', async () => {
        runScreener.mockResolvedValue(
            screenerResult([
                candidate('A', 0),
                candidate('B', 0),
                candidate('C', 3),
                candidate('D', 3),
                candidate('E', 3),
                candidate('F', 3),
                candidate('G', 3),
                candidate('H', 3),
            ])
        );

        await runDailyDigest();

        const input = buildDigestMessages.mock.calls[0][0] as { stockPicks: { symbol: string }[] };
        // Six matched; the digest is a phone notification, so it carries the top five.
        expect(input.stockPicks).toHaveLength(5);
        expect(input.stockPicks.map((pick) => pick.symbol)).toEqual(['C', 'D', 'E', 'F', 'G']);
        expect(input.stockPicks.map((pick) => pick.symbol)).not.toContain('A');
    });

    it('reports success when only one of the two sends worked', async () => {
        sendTelegramMessage
            .mockResolvedValueOnce({ ok: false, error: 'chat not found' })
            .mockResolvedValueOnce({ ok: true, messageId: 2 });

        const result = await runDailyDigest();

        // Half the digest arriving is a partial success, not a failure — and `sent` says which
        // half, so it is actionable rather than just red.
        expect(result.ok).toBe(true);
        expect(result.sent).toEqual({ stocks: false, crypto: true });
    });

    it('reports a screener failure instead of throwing', async () => {
        runScreener.mockRejectedValue(new Error('screener exploded'));

        const result = await runDailyDigest();

        // The scheduler wraps this in a job outcome; a throw here would be recorded as a crash
        // with no useful message.
        expect(result.ok).toBe(false);
        expect(result.error).toBe('screener exploded');
        expect(sendTelegramMessage).not.toHaveBeenCalled();
    });

    it('still sends when there is no admin user to attribute holdings to', async () => {
        getAdminUserId.mockResolvedValue(null);

        const result = await runDailyDigest();

        expect(getPortfolioSummaryForUser).not.toHaveBeenCalled();
        const input = buildDigestMessages.mock.calls[0][0] as { holdings: unknown[] };
        expect(input.holdings).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it('passes holdings through to the message builder', async () => {
        getPortfolioSummaryForUser.mockResolvedValue({
            holdings: [
                { symbol: 'AAPL', quantity: 2, pnlPercent: 4.5, marketValue: 300 },
            ],
            totalValue: 300,
            totalPnlPercent: 4.5,
            unpricedSymbols: [],
            totalCost: 287,
            totalPnl: 13,
        });

        await runDailyDigest();

        expect(getPortfolioSummaryForUser).toHaveBeenCalledWith('admin-1');
        const input = buildDigestMessages.mock.calls[0][0] as {
            holdings: { symbol: string }[];
            totalValue: number;
        };
        expect(input.holdings).toHaveLength(1);
        expect(input.totalValue).toBe(300);
    });
});
