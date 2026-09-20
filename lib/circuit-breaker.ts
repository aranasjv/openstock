/**
 * Account-level circuit breaker — the rules from `.agents/skills/drawdown-circuit-breaker`.
 *
 * Pure, and **realized-only**. The playbook is emphatic that this reads realized P&L from the
 * ledger rather than unrealized P&L or thesis-level cumulative fields, because the failure it
 * exists to prevent is escalating risk after damage that has actually been taken. An open position
 * that is down is not damage yet; a closed one is.
 *
 * Two properties are counter-intuitive and both are load-bearing:
 * - **Empty state allows trading.** A new user with no history is not blocked — a breaker that
 *   cannot be satisfied without prior losses would make the first trade impossible.
 * - **Incomplete state halts.** Anything unreadable fails closed. A breaker that silently ignores
 *   the records it cannot parse reports safety it never verified, which is worse than having none.
 *
 * Day, week and month boundaries are America/New_York, per the playbook. Release dates are computed
 * as the next eligible ET weekday rather than from the XNYS session calendar: market holidays are
 * not modelled, so a halt can end a day early around one. That is a documented approximation, not
 * an oversight.
 */

const ET_ZONE = 'America/New_York';

const ET_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

const ET_PART_FORMAT = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

const ET_WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: ET_ZONE, weekday: 'short' });

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface CircuitBreakerConfig {
    /** Percentage of account size. */
    maxDailyLossPct: number;
    /** Consecutive terminal losing theses before a cooldown. */
    losingStreakN: number;
    cooldownHours: number;
    weeklyDrawdownPct: number;
    monthlyDrawdownPct: number;
}

export const DEFAULT_BREAKER_CONFIG: CircuitBreakerConfig = {
    maxDailyLossPct: 2.0,
    losingStreakN: 2,
    cooldownHours: 24,
    weeklyDrawdownPct: 5.0,
    monthlyDrawdownPct: 8.0,
};

/** One realized result, taken from a ledger entry. `at` is when the P&L landed. */
export interface RealisedEvent {
    at: string;
    pnl: number;
}

export interface BreakerRule {
    rule: string;
    threshold: number;
    observed: number;
    /** ISO instant the rule lifts, or null when it lifts only on repair and rerun. */
    activeUntil: string | null;
    detail: string;
}

export type BreakerRecommendation = 'TRADING_ALLOWED' | 'COOLDOWN' | 'HALTED';
export type BreakerDataQuality = 'OK' | 'EMPTY_STATE' | 'PARTIAL';

export interface BreakerMetrics {
    realizedPnlToday: number;
    realizedPnlWeek: number;
    realizedPnlMonth: number;
    consecutiveLosses: number;
    lastLossExitAt: string | null;
    eventsConsidered: number;
}

export interface BreakerDecision {
    recommendation: BreakerRecommendation;
    triggeredRules: BreakerRule[];
    metrics: BreakerMetrics;
    dataQuality: BreakerDataQuality;
    rationale: string;
}

export interface BreakerInput {
    events: RealisedEvent[];
    accountSize: number;
    asOf: Date;
    config?: Partial<CircuitBreakerConfig>;
    /** Reasons the account state could not be read in full — any entry forces a fail-closed halt. */
    incomplete?: string[];
    /**
     * Gaps that are reported but must **not** override the computed recommendation. The playbook
     * draws this line for one case: a legacy thesis carrying a finite terminal `pnl_dollars` instead
     * of a realized ledger. Failing closed there would halt a book whose numbers are actually sound.
     */
    recoverable?: string[];
}

/** The ET calendar date of an instant, as YYYY-MM-DD. */
export function etDate(date: Date): string {
    return ET_DATE_FORMAT.format(date);
}

function etWeekday(date: Date): number {
    return WEEKDAY_INDEX[ET_WEEKDAY_FORMAT.format(date)] ?? 0;
}

/** Minutes that ET is ahead of UTC at a given instant. Handles DST because Intl does. */
function etOffsetMinutes(date: Date): number {
    const parts = ET_PART_FORMAT.formatToParts(date);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');

    const asUtc = Date.UTC(
        value('year'),
        value('month') - 1,
        value('day'),
        value('hour') % 24,
        value('minute'),
        value('second')
    );

    return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000;
}

/** The UTC instant of 00:00 ET on a given ET calendar date. */
export function etMidnightUtc(day: string): Date {
    const guess = new Date(`${day}T00:00:00Z`);
    return new Date(guess.getTime() - etOffsetMinutes(guess) * 60_000);
}

/** The next ET weekday (Monday–Friday) at 00:00, for a daily halt's release. */
export function nextEtWeekday(from: Date): Date {
    let probe = from;
    for (let step = 0; step < 8; step += 1) {
        probe = new Date(probe.getTime() + 24 * 60 * 60 * 1000);
        const weekday = etWeekday(probe);
        if (weekday >= 1 && weekday <= 5) return etMidnightUtc(etDate(probe));
    }
    return etMidnightUtc(etDate(from));
}

/** The Monday of the ET week containing `from`, at 00:00. */
export function startOfEtWeek(from: Date): Date {
    const weekday = etWeekday(from);
    const back = weekday === 0 ? 6 : weekday - 1;
    return etMidnightUtc(etDate(new Date(from.getTime() - back * 24 * 60 * 60 * 1000)));
}

/** 00:00 ET on the first day of the next ET month. */
export function startOfNextEtMonth(from: Date): Date {
    const [year, month] = etDate(from).split('-').map(Number);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return etMidnightUtc(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01`);
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function sum(events: RealisedEvent[]): number {
    return round2(events.reduce((total, event) => total + event.pnl, 0));
}

/**
 * Consecutive losing closes, most recent first. A win resets the count, which is the playbook's
 * definition — this is a streak of outcomes, not a running total.
 */
export function consecutiveLosses(events: RealisedEvent[]): number {
    const ordered = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    let streak = 0;
    for (const event of ordered) {
        if (event.pnl >= 0) break;
        streak += 1;
    }
    return streak;
}

export function evaluateCircuitBreaker(input: BreakerInput): BreakerDecision {
    const config: CircuitBreakerConfig = { ...DEFAULT_BREAKER_CONFIG, ...input.config };
    const incomplete = input.incomplete ?? [];
    const recoverable = input.recoverable ?? [];

    const cannotEvaluate =
        incomplete.length > 0 ||
        !Number.isFinite(input.accountSize) ||
        input.accountSize <= 0 ||
        input.events.some((event) => !Number.isFinite(event.pnl) || !Number.isFinite(Date.parse(event.at)));

    if (cannotEvaluate) {
        const reasons = [...incomplete];
        if (!Number.isFinite(input.accountSize) || input.accountSize <= 0) {
            reasons.push('account size is missing or not a positive number');
        }
        if (input.events.some((event) => !Number.isFinite(event.pnl) || !Number.isFinite(Date.parse(event.at)))) {
            reasons.push('a ledger entry has a non-finite P&L or an unparseable timestamp');
        }

        return {
            recommendation: 'HALTED',
            triggeredRules: [
                {
                    rule: 'incomplete_state_data',
                    threshold: 0,
                    observed: reasons.length,
                    activeUntil: null,
                    detail: `Cannot evaluate the breaker: ${reasons.join('; ')}. Repair the journal and rerun.`,
                },
            ],
            metrics: {
                realizedPnlToday: 0,
                realizedPnlWeek: 0,
                realizedPnlMonth: 0,
                consecutiveLosses: 0,
                lastLossExitAt: null,
                eventsConsidered: 0,
            },
            dataQuality: 'PARTIAL',
            rationale: 'Account state could not be read in full, so new risk is halted until it is repaired.',
        };
    }

    // Only events at or before the evaluation instant count, so an `--as-of` replay is possible.
    const events = input.events.filter((event) => Date.parse(event.at) <= input.asOf.getTime());

    if (events.length === 0) {
        return {
            recommendation: 'TRADING_ALLOWED',
            triggeredRules: [],
            metrics: {
                realizedPnlToday: 0,
                realizedPnlWeek: 0,
                realizedPnlMonth: 0,
                consecutiveLosses: 0,
                lastLossExitAt: null,
                eventsConsidered: 0,
            },
            dataQuality: 'EMPTY_STATE',
            rationale: 'No realized results on record. Nothing to breach, so new risk is allowed.',
        };
    }

    const today = etDate(input.asOf);
    const weekStart = startOfEtWeek(input.asOf);
    const month = today.slice(0, 7);

    const todayEvents = events.filter((event) => etDate(new Date(event.at)) === today);
    const weekEvents = events.filter((event) => Date.parse(event.at) >= weekStart.getTime());
    const monthEvents = events.filter((event) => etDate(new Date(event.at)).slice(0, 7) === month);

    const realizedToday = sum(todayEvents);
    const realizedWeek = sum(weekEvents);
    const realizedMonth = sum(monthEvents);
    const streak = consecutiveLosses(events);
    const lastLoss = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).find((event) => event.pnl < 0) ?? null;

    const dailyLimit = round2((input.accountSize * config.maxDailyLossPct) / 100);
    const weeklyLimit = round2((input.accountSize * config.weeklyDrawdownPct) / 100);
    const monthlyLimit = round2((input.accountSize * config.monthlyDrawdownPct) / 100);

    const triggered: BreakerRule[] = [];

    if (realizedToday <= -dailyLimit) {
        triggered.push({
            rule: 'max_daily_loss',
            threshold: config.maxDailyLossPct,
            observed: round2((realizedToday / input.accountSize) * 100),
            activeUntil: nextEtWeekday(input.asOf).toISOString(),
            detail: `Lost ${Math.abs(realizedToday).toFixed(2)} today, at or past the ${config.maxDailyLossPct}% daily limit.`,
        });
    }

    if (realizedWeek <= -weeklyLimit) {
        triggered.push({
            rule: 'weekly_drawdown_halt',
            threshold: config.weeklyDrawdownPct,
            observed: round2((realizedWeek / input.accountSize) * 100),
            activeUntil: startOfEtWeek(new Date(input.asOf.getTime() + 7 * 24 * 60 * 60 * 1000)).toISOString(),
            detail: `Down ${Math.abs(realizedWeek).toFixed(2)} this week, at or past the ${config.weeklyDrawdownPct}% weekly limit.`,
        });
    }

    if (realizedMonth <= -monthlyLimit) {
        triggered.push({
            rule: 'monthly_drawdown_halt',
            threshold: config.monthlyDrawdownPct,
            observed: round2((realizedMonth / input.accountSize) * 100),
            activeUntil: startOfNextEtMonth(input.asOf).toISOString(),
            detail: `Down ${Math.abs(realizedMonth).toFixed(2)} this month, at or past the ${config.monthlyDrawdownPct}% monthly limit.`,
        });
    }

    if (streak >= config.losingStreakN && lastLoss) {
        const release = new Date(Date.parse(lastLoss.at) + config.cooldownHours * 60 * 60 * 1000);
        triggered.push({
            rule: 'losing_streak_cooldown',
            threshold: config.losingStreakN,
            observed: streak,
            activeUntil: release.toISOString(),
            detail: `${streak} consecutive losing closes; the last was ${lastLoss.at}.`,
        });
    }

    // A halt outranks a cooldown: both stop new entries, but only one means a limit was actually
    // breached, and reporting the milder of the two would understate what happened.
    const halted = triggered.some((rule) => rule.rule !== 'losing_streak_cooldown');
    const recommendation: BreakerRecommendation = halted ? 'HALTED' : triggered.length > 0 ? 'COOLDOWN' : 'TRADING_ALLOWED';

    const rationale =
        recommendation === 'HALTED'
            ? 'A drawdown limit has been breached. Stop new entries until the rule lifts.'
            : recommendation === 'COOLDOWN'
              ? 'Recent losing closes triggered a cooldown. Avoid new entries until it expires.'
              : 'No circuit breaker rule is active. New trade risk may proceed.';

    return {
        recommendation,
        triggeredRules: triggered,
        metrics: {
            realizedPnlToday: realizedToday,
            realizedPnlWeek: realizedWeek,
            realizedPnlMonth: realizedMonth,
            consecutiveLosses: streak,
            lastLossExitAt: lastLoss?.at ?? null,
            eventsConsidered: events.length,
        },
        dataQuality: recoverable.length > 0 ? 'PARTIAL' : 'OK',
        rationale,
    };
}
