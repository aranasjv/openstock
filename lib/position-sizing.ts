/**
 * Position sizing.
 *
 * Transcribed from the vendored `position-sizer` playbook rather than invented: risk-first
 * sizing is where a strategy either survives or does not, and an ad-hoc formula here would be
 * the most expensive thing in the app to get subtly wrong.
 *
 * The method is deliberately the boring one. Size comes from the distance to the stop, never
 * from conviction, so a wider stop automatically buys fewer shares — the loss if the idea is
 * wrong is the same either way. Conviction-scaled sizing inverts that, and it is how a
 * high-conviction loser becomes the position that ends the account.
 *
 * Not here, deliberately:
 *   - Kelly / half-Kelly is in the playbook but needs a realised win rate and payoff ratio.
 *     There is no trade store yet (trade journal is phase D), so any Kelly output now would be
 *     a number derived from a guess. The playbook says the same: stop if win rate is unavailable.
 *   - Shorts. `entry` above `stop` is the only shape this understands, and it says so rather
 *     than silently returning a negative share count.
 */

export interface PositionSizeInput {
    /** Total account equity in currency units. */
    equity: number;
    /** Intended entry price. */
    entry: number;
    /** Stop price, below entry. This is what defines the risk, and it is required. */
    stop: number;
    /** Fraction of equity risked per trade, as a percentage. Playbook default 1, cap 2. */
    riskPercent?: number;
    /** Ceiling on a single position as a percentage of equity. Playbook default 10. */
    maxPositionPercent?: number;
    /** Open risk already committed across other positions, as a percentage of equity. */
    currentHeatPercent?: number;
    /** Ceiling on total open risk. Playbook default 6. */
    maxPortfolioHeatPercent?: number;
}

export type BindingConstraint = 'risk' | 'max-position' | 'portfolio-heat' | 'none';

export interface PositionSizeResult {
    /** Whole shares. Never rounds up — rounding up is a silent increase in risk. */
    shares: number;
    /** What is actually lost if the stop triggers, at this size. */
    riskDollars: number;
    notional: number;
    stopDistance: number;
    /** Which ceiling produced the final size, so the number can be explained. */
    bindingConstraint: BindingConstraint;
    notes: string[];
}

const DEFAULT_RISK_PERCENT = 1;
const DEFAULT_MAX_POSITION_PERCENT = 10;
const DEFAULT_MAX_PORTFOLIO_HEAT_PERCENT = 6;
/** The playbook's hard cap. Beyond this, one bad trade costs a tenth of the account. */
const MAX_RISK_PERCENT = 2;

function floorShares(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function sizePosition(input: PositionSizeInput): PositionSizeResult {
    const notes: string[] = [];

    const equity = input.equity;
    const entry = input.entry;
    const stop = input.stop;

    if (!Number.isFinite(equity) || equity <= 0) {
        return empty('Equity must be a positive number.');
    }
    if (!Number.isFinite(entry) || entry <= 0) {
        return empty('Entry price must be a positive number.');
    }
    if (!Number.isFinite(stop) || stop <= 0) {
        return empty('A stop price is required — sizing without one is not sizing.');
    }
    if (stop >= entry) {
        return empty('This sizes long positions only, so the stop must sit below the entry.');
    }

    let riskPercent = input.riskPercent ?? DEFAULT_RISK_PERCENT;
    if (!Number.isFinite(riskPercent) || riskPercent <= 0) riskPercent = DEFAULT_RISK_PERCENT;
    if (riskPercent > MAX_RISK_PERCENT) {
        // Clamped rather than rejected: a caller asking for 10% per trade still gets a usable
        // answer, and the note says what was actually applied.
        notes.push(`Risk per trade capped at ${MAX_RISK_PERCENT}% (requested ${riskPercent}%).`);
        riskPercent = MAX_RISK_PERCENT;
    }

    const maxPositionPercent = input.maxPositionPercent ?? DEFAULT_MAX_POSITION_PERCENT;
    const maxHeatPercent = input.maxPortfolioHeatPercent ?? DEFAULT_MAX_PORTFOLIO_HEAT_PERCENT;
    const currentHeatPercent = input.currentHeatPercent ?? 0;

    const stopDistance = entry - stop;
    const riskBudget = (equity * riskPercent) / 100;
    const positionCeiling = (equity * maxPositionPercent) / 100;
    const heatCeiling = Math.max(0, ((maxHeatPercent - currentHeatPercent) / 100) * equity);

    const byRisk = floorShares(riskBudget / stopDistance);
    const byPosition = floorShares(positionCeiling / entry);
    const byHeat = floorShares(heatCeiling / stopDistance);

    const candidates: { shares: number; constraint: BindingConstraint }[] = [
        { shares: byRisk, constraint: 'risk' },
        { shares: byPosition, constraint: 'max-position' },
        { shares: byHeat, constraint: 'portfolio-heat' },
    ];

    const winning = candidates.reduce((lowest, candidate) =>
        candidate.shares < lowest.shares ? candidate : lowest
    );

    const shares = winning.shares;
    const riskDollars = shares * stopDistance;

    if (shares === 0) {
        // Distinguish the two reasons a size can be zero, because the fix differs: one is a
        // sizing problem, the other is that the book is already full.
        const reason =
            heatCeiling < stopDistance
                ? 'Open risk already meets or exceeds the portfolio heat ceiling — no new risk is available.'
                : 'The risk budget is smaller than the stop distance, so no whole share fits.';
        return {
            shares: 0,
            riskDollars: 0,
            notional: 0,
            stopDistance,
            bindingConstraint: winning.constraint,
            notes: [...notes, reason],
        };
    }

    if (winning.constraint !== 'risk') {
        notes.push(
            `Size limited by ${winning.constraint === 'max-position' ? 'the position ceiling' : 'remaining portfolio heat'}, not by the risk budget.`
        );
    }

    notes.push(
        `Risking ${riskDollars.toFixed(2)} (${((riskDollars / equity) * 100).toFixed(2)}% of equity) across ${shares} share${shares === 1 ? '' : 's'}.`
    );

    return {
        shares,
        riskDollars,
        notional: shares * entry,
        stopDistance,
        bindingConstraint: winning.constraint,
        notes,
    };
}

/**
 * Stop distance from ATR, for when there is no obvious level to hang a stop on.
 *
 * Two ATRs by default: wide enough that ordinary noise does not take the position out, tight
 * enough that the resulting size is still worth holding. The real constraint on the multiple is
 * that a wider stop buys proportionally fewer shares, so a stop set too wide is a position too
 * small to matter.
 */
export function stopFromAtr(entry: number, atr: number, multiplier = 2): number | null {
    if (!Number.isFinite(entry) || entry <= 0) return null;
    if (!Number.isFinite(atr) || atr <= 0) return null;
    if (!Number.isFinite(multiplier) || multiplier <= 0) return null;

    const stop = entry - atr * multiplier;
    // A stop at or below zero is not a stop, it is a total loss.
    return stop > 0 ? stop : null;
}

function empty(reason: string): PositionSizeResult {
    return {
        shares: 0,
        riskDollars: 0,
        notional: 0,
        stopDistance: 0,
        bindingConstraint: 'none',
        notes: [reason],
    };
}
