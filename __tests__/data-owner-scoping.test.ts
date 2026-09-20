import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Owner scoping in the data layer.
 *
 * The authorisation fix is not a check that can be forgotten — it is the query filter. These
 * tests assert the filter, because "the action resolved a session" is worth nothing if the
 * query then runs unfiltered:
 *
 *   deleteAlert used to call Alert.findByIdAndDelete(alertId), which deletes whatever id it is
 *   given. Any signed-in user could delete any alert on the deployment.
 *
 * Asserting the filter is the difference between testing the intent and testing the mechanism.
 */

const VALID_ID = '507f1f77bcf86cd799439011';

const alertFindOne = vi.fn();
vi.mock('@/database/models/alert.model', () => ({
    Alert: { findOne: (filter: unknown) => alertFindOne(filter) },
}));

const watchlistFindOneAndDelete = vi.fn();
vi.mock('@/database/models/watchlist.model', () => ({
    Watchlist: {
        findOneAndDelete: (filter: unknown) => watchlistFindOneAndDelete(filter),
    },
}));

vi.mock('@/database/mongoose', () => ({
    connectToDatabase: async () => ({
        isValidObjectId: (id: string) => /^[0-9a-f]{24}$/i.test(id),
    }),
}));

import { deleteAlertForUser, toggleAlertForUser } from '@/lib/data/alerts';
import { removeFromWatchlistForUser } from '@/lib/data/watchlist';

beforeEach(() => {
    vi.clearAllMocks();
    alertFindOne.mockResolvedValue(null);
    watchlistFindOneAndDelete.mockResolvedValue(null);
});

describe('alert mutations are scoped by owner', () => {
    it('looks an alert up by owner as well as id', async () => {
        await deleteAlertForUser('owner-1', VALID_ID);

        expect(alertFindOne).toHaveBeenCalledWith({ _id: VALID_ID, userId: 'owner-1' });
    });

    it('deletes only the document that matched the owner filter', async () => {
        const deleteOne = vi.fn();
        alertFindOne.mockResolvedValue({ deleteOne });

        const result = await deleteAlertForUser('owner-1', VALID_ID);

        expect(deleteOne).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ success: true });
    });

    it('reports someone else’s alert as not found rather than deleting it', async () => {
        // The owner filter does not match, so nothing is returned and nothing is deleted.
        alertFindOne.mockResolvedValue(null);

        const result = await deleteAlertForUser('attacker', VALID_ID);

        expect(result).toEqual({ success: false });
        expect(alertFindOne).toHaveBeenCalledWith({ _id: VALID_ID, userId: 'attacker' });
    });

    it('toggles only the owner’s alert', async () => {
        const updateOne = vi.fn();
        alertFindOne.mockResolvedValue({ updateOne });

        const result = await toggleAlertForUser('owner-1', VALID_ID, false);

        expect(alertFindOne).toHaveBeenCalledWith({ _id: VALID_ID, userId: 'owner-1' });
        expect(updateOne).toHaveBeenCalledWith({ active: false });
        expect(result).toEqual({ success: true });
    });

    it('treats a malformed id as not found instead of throwing', async () => {
        const result = await deleteAlertForUser('owner-1', 'not-an-object-id');

        expect(result).toEqual({ success: false });
        expect(alertFindOne).not.toHaveBeenCalled();
    });
});

describe('watchlist mutations are scoped by owner', () => {
    it('filters the delete by owner, symbol and asset type', async () => {
        await removeFromWatchlistForUser('owner-1', 'aapl', 'stock');

        expect(watchlistFindOneAndDelete).toHaveBeenCalledWith({
            userId: 'owner-1',
            symbol: 'AAPL',
            assetType: 'stock',
        });
    });
});
