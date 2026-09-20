import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Authorisation of the personal server actions.
 *
 * These are the tests the review said were missing, and they are the reason the original hole
 * survived: `lib/actions/*` had no coverage at all, so nothing asserted *whose* data an action
 * touches. The pattern below is the one that would have caught it — "the owner comes from the
 * session, and the caller cannot influence it".
 *
 * Note what is being asserted: not that a bad userId is rejected (there is no longer a userId
 * to pass), but that the identity is never an input in the first place.
 */

const requireUserId = vi.fn();
vi.mock('@/lib/session', () => ({ requireUserId: () => requireUserId() }));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const deleteAlertForUser = vi.fn();
const toggleAlertForUser = vi.fn();
const getAlertsForUser = vi.fn();
const createAlertForUser = vi.fn();

vi.mock('@/lib/data/alerts', () => ({
    createAlertForUser: (...args: unknown[]) => createAlertForUser(...args),
    deleteAlertForUser: (...args: unknown[]) => deleteAlertForUser(...args),
    getAlertsForUser: (...args: unknown[]) => getAlertsForUser(...args),
    toggleAlertForUser: (...args: unknown[]) => toggleAlertForUser(...args),
}));

const addHoldingForUser = vi.fn();
const removeHoldingForUser = vi.fn();
const getHoldingsForUser = vi.fn();
const getPortfolioSummaryForUser = vi.fn();

vi.mock('@/lib/data/portfolio', () => ({
    addHoldingForUser: (...args: unknown[]) => addHoldingForUser(...args),
    removeHoldingForUser: (...args: unknown[]) => removeHoldingForUser(...args),
    getHoldingsForUser: (...args: unknown[]) => getHoldingsForUser(...args),
    getPortfolioSummaryForUser: (...args: unknown[]) => getPortfolioSummaryForUser(...args),
}));

const addToWatchlistForUser = vi.fn();
const removeFromWatchlistForUser = vi.fn();
const getWatchlistForUser = vi.fn();
const isInWatchlistForUser = vi.fn();

vi.mock('@/lib/data/watchlist', () => ({
    addToWatchlistForUser: (...args: unknown[]) => addToWatchlistForUser(...args),
    removeFromWatchlistForUser: (...args: unknown[]) => removeFromWatchlistForUser(...args),
    getWatchlistForUser: (...args: unknown[]) => getWatchlistForUser(...args),
    isInWatchlistForUser: (...args: unknown[]) => isInWatchlistForUser(...args),
}));

import { deleteAlert, toggleAlert, getUserAlerts } from '@/lib/actions/alert.actions';
import { addHolding, removeHolding, getPortfolioSummary } from '@/lib/actions/holdings.actions';
import {
    addToWatchlist,
    removeFromWatchlist,
    getUserWatchlist,
} from '@/lib/actions/watchlist.actions';

beforeEach(() => {
    vi.clearAllMocks();
    requireUserId.mockResolvedValue('session-user');

    getAlertsForUser.mockResolvedValue([]);
    getPortfolioSummaryForUser.mockResolvedValue({ holdings: [] });
    getHoldingsForUser.mockResolvedValue([]);
    getWatchlistForUser.mockResolvedValue([]);
    deleteAlertForUser.mockResolvedValue({ success: true });
    toggleAlertForUser.mockResolvedValue({ success: true });
});

describe('actions derive the owner from the session', () => {
    it('scopes an alert delete to the session user', async () => {
        await deleteAlert('alert-9');

        expect(deleteAlertForUser).toHaveBeenCalledWith('session-user', 'alert-9');
    });

    it('scopes an alert toggle to the session user', async () => {
        await toggleAlert('alert-9', false);

        expect(toggleAlertForUser).toHaveBeenCalledWith('session-user', 'alert-9', false);
    });

    it('scopes alert reads to the session user', async () => {
        await getUserAlerts('crypto');

        expect(getAlertsForUser).toHaveBeenCalledWith('session-user', 'crypto');
    });

    it('scopes a holding write to the session user', async () => {
        await addHolding({ symbol: 'AAPL', assetType: 'stock', quantity: 2, averageCost: 10 });

        expect(addHoldingForUser).toHaveBeenCalledWith('session-user', {
            symbol: 'AAPL',
            assetType: 'stock',
            quantity: 2,
            averageCost: 10,
        });
    });

    it('scopes a holding delete to the session user', async () => {
        await removeHolding('AAPL', 'stock');

        expect(removeHoldingForUser).toHaveBeenCalledWith('session-user', 'AAPL', 'stock');
    });

    it('scopes the portfolio read to the session user', async () => {
        await getPortfolioSummary();

        expect(getPortfolioSummaryForUser).toHaveBeenCalledWith('session-user', undefined);
    });

    it('scopes a watchlist add to the session user', async () => {
        await addToWatchlist('AAPL', 'Apple Inc.');

        expect(addToWatchlistForUser).toHaveBeenCalledWith('session-user', 'AAPL', 'Apple Inc.', 'stock');
    });

    it('scopes a watchlist remove to the session user', async () => {
        await removeFromWatchlist('BTC', 'crypto');

        expect(removeFromWatchlistForUser).toHaveBeenCalledWith('session-user', 'BTC', 'crypto');
    });

    it('scopes a watchlist read to the session user', async () => {
        await getUserWatchlist();

        expect(getWatchlistForUser).toHaveBeenCalledWith('session-user', undefined);
    });
});

describe('nothing happens without a session', () => {
    it('refuses an alert delete and never reaches the data layer', async () => {
        requireUserId.mockRejectedValue(new Error('Not signed in.'));

        await expect(deleteAlert('alert-9')).rejects.toThrow('Not signed in.');
        expect(deleteAlertForUser).not.toHaveBeenCalled();
    });

    it('refuses a watchlist write', async () => {
        requireUserId.mockRejectedValue(new Error('Not signed in.'));

        await expect(addToWatchlist('AAPL', 'Apple Inc.')).rejects.toThrow('Not signed in.');
        expect(addToWatchlistForUser).not.toHaveBeenCalled();
    });

    it('refuses a portfolio read', async () => {
        requireUserId.mockRejectedValue(new Error('Not signed in.'));

        await expect(getPortfolioSummary()).rejects.toThrow('Not signed in.');
        expect(getPortfolioSummaryForUser).not.toHaveBeenCalled();
    });
});
