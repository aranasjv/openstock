import { describe, it, expect } from 'vitest';
import {
    consecutiveLosses,
    etDate,
    evaluateCircuitBreaker,
    nextEtWeekday,
    startOfEtWeek,
    startOfNextEtMonth,
    type RealisedEvent,
} from '@/lib/circuit-breaker';

/**
 * 2026-07-02 is a Thursday, so the ET week containing it starts Monday 2026-06-29. Every date below
 * is chosen around that so the day/week/month buckets are unambiguous.
 */
const AS_OF = new Date('2026-07-02T16:00:00Z');
const ACCOUNT = 100_000;

const loss = (at: string, pnl: number): RealisedEvent => ({ at, pnl });

describe('calendar helpers', () => {
    it('maps an instant to its ET calendar date, not its UTC one', () => {
        // 03:00Z on the 3rd is still 23:00 on the 2nd in New York.
        expect(etDate(new Date('2026-07-03T03:00:00Z'))).toBe('2026-07-02');
        expect(etDate(new Date('2026-07-03T05:00:00Z'))).toBe('2026-07-03');
    });

    it('finds the next ET weekday and skips the weekend', () => {
        // Thursday -> Friday.
        expect(etDate(nextEtWeekday(AS_OF))).toBe('2026-07-03');
        // Friday -> Monday.
        expect(etDate(nextEtWeekday(new Date('2026-07-03T16:00:00Z')))).toBe('2026-07-06');
    });

    it('anchors the week on Monday ET and the month on the first', () => {
        expect(etDate(startOfEtWeek(AS_OF))).toBe('2026-06-29');
        expect(etDate(startOfNextEtMonth(AS_OF))).toBe('2026-08-01');
        // A Sunday belongs to the week that began six days earlier, not to the one starting tomorrow.
        expect(etDate(startOfEtWeek(new Date('2026-07-05T16:00:00Z')))).toBe('2026-06-29');
    });
});

describe('evaluateCircuitBreaker', () => {
    it('allows trading on empty state, so a new journal is not a block', () => {
        const decision = evaluateCircuitBreaker({ events: [], accountSize: ACCOUNT, asOf: AS_OF });

        expect(decision.recommendation).toBe('TRADING_ALLOWED');
        expect(decision.dataQuality).toBe('EMPTY_STATE');
        expect(decision.triggeredRules).toEqual([]);
    });

    it('allows trading when nothing has been lost', () => {
        const decision = evaluateCircuitBreaker({
            events: [loss('2026-07-02T14:00:00Z', -100)],
            accountSize: ACCOUNT,
            asOf: AS_OF,
        });

        expect(decision.recommendation).toBe('TRADING_ALLOWED');
        expect(decision.dataQuality).toBe('OK');
        expect(decision.metrics.realizedPnlToday).toBe(-100);
    });

    it('halts once the daily loss limit is reached', () => {
        const decision = evaluateCircuitBreaker({
            events: [loss('2026-07-02T14:00:00Z', -2_000)],
            accountSize: ACCOUNT,
            asOf: AS_OF,
        });

        expect(decision.recommendation).toBe('HALTED');
        expect(decision.triggeredRules.map((rule) => rule.rule)).toContain('max_daily_loss');
        // It lifts on the next ET weekday, not immediately.
        expect(etDate(new Date(decision.triggeredRules[0].activeUntil!))).toBe('2026-07-03');
    });

    it('halts on the weekly limit even when no single day breached it', () => {
        const decision = evaluateCircuitBreaker({
            events: [
                loss('2026-06-29T14:00:00Z', -1_700),
                loss('2026-06-30T14:00:00Z', -1_700),
                loss('2026-07-01T14:00:00Z', -1_700),
            ],
            accountSize: ACCOUNT,
            asOf: AS_OF,
        });

        expect(decision.recommendation).toBe('HALTED');
        expect(decision.triggeredRules.map((rule) => rule.rule)).toContain('weekly_drawdown_halt');
        expect(decision.metrics.realizedPnlToday).toBe(0);
        expect(decision.metrics.realizedPnlWeek).toBe(-5_100);
    });

    it('halts on the monthly limit', () => {
        const decision = evaluateCircuitBreaker({
            events: [
                loss('2026-07-06T14:00:00Z', -2_000),
                loss('2026-07-13T14:00:00Z', -2_000),
                loss('2026-07-20T14:00:00Z', -2_000),
                loss('2026-07-27T14:00:00Z', -2_000),
            ],
            accountSize: ACCOUNT,
            asOf: new Date('2026-07-31T16:00:00Z'),
        });

        expect(decision.recommendation).toBe('HALTED');
        expect(decision.triggeredRules.map((rule) => rule.rule)).toContain('monthly_drawdown_halt');
    });

    it('cools down rather than halting on a losing streak under every limit', () => {
        const decision = evaluateCircuitBreaker({
            events: [loss('2026-07-01T14:00:00Z', -100), loss('2026-07-02T14:00:00Z', -100)],
            accountSize: ACCOUNT,
            asOf: AS_OF,
        });

        expect(decision.recommendation).toBe('COOLDOWN');
        expect(decision.triggeredRules.map((rule) => rule.rule)).toEqual(['losing_streak_cooldown']);
        // 24 hours from the latest loss exit.
        expect(decision.triggeredRules[0].activeUntil).toBe('2026-07-03T14:00:00.000Z');
    });

    it('reports a halt when a streak and a limit are both active', () => {
        const decision = evaluateCircuitBreaker({
            events: [loss('2026-07-01T14:00:00Z', -100), loss('2026-07-02T14:00:00Z', -2_500)],
            accountSize: ACCOUNT,
            asOf: AS_OF,
        });

        // Both fired, and the stricter recommendation wins: a breached limit is a different situation
        // from a streak, and reporting the milder one would understate it.
        expect(decision.triggeredRules.map((rule) => rule.rule).sort()).toEqual([
            'losing_streak_cooldown',
            'max_daily_loss',
        ]);
        expect(decision.recommendation).toBe('HALTED');
    });

    it('fails closed on incomplete account state', () => {
        const decision = evaluateCircuitBreaker({
            events: [],
            accountSize: ACCOUNT,
            asOf: AS_OF,
            incomplete: ['thesis th_9 has a malformed status history'],
        });

        expect(decision.recommendation).toBe('HALTED');
        expect(decision.dataQuality).toBe('PARTIAL');
        expect(decision.triggeredRules[0].rule).toBe('incomplete_state_data');
        expect(decision.triggeredRules[0].activeUntil).toBeNull();
    });

    it('fails closed rather than coercing a non-finite P&L', () => {
        const decision = evaluateCircuitBreaker({
            events: [loss('2026-07-02T14:00:00Z', Number.NaN)],
            accountSize: ACCOUNT,
            asOf: AS_OF,
        });

        expect(decision.recommendation).toBe('HALTED');
        expect(decision.dataQuality).toBe('PARTIAL');
    });

    it('fails closed without a usable account size', () => {
        expect(evaluateCircuitBreaker({ events: [], accountSize: 0, asOf: AS_OF }).dataQuality).toBe('PARTIAL');
        expect(evaluateCircuitBreaker({ events: [], accountSize: Number.NaN, asOf: AS_OF }).recommendation).toBe('HALTED');
    });

    it('ignores results that had not happened yet at the evaluation instant', () => {
        const decision = evaluateCircuitBreaker({
            events: [loss('2026-07-02T14:00:00Z', -100), loss('2026-08-01T14:00:00Z', -9_000)],
            accountSize: ACCOUNT,
            asOf: AS_OF,
        });

        // The August loss is in the future relative to as-of, so it cannot breach anything yet.
        expect(decision.metrics.eventsConsidered).toBe(1);
        expect(decision.recommendation).toBe('TRADING_ALLOWED');
    });

    it('resets the streak on a win', () => {
        expect(
            consecutiveLosses([
                loss('2026-07-01T14:00:00Z', -100),
                loss('2026-07-02T14:00:00Z', -100),
                loss('2026-07-03T14:00:00Z', 50),
            ])
        ).toBe(0);
    });

    it('reports a recoverable gap without overriding the recommendation', () => {
        const decision = evaluateCircuitBreaker({
            events: [loss('2026-07-02T14:00:00Z', -100)],
            accountSize: ACCOUNT,
            asOf: AS_OF,
            recoverable: ['AAPL was closed without a realized ledger; its pnl_dollars fallback was used'],
        });

        // Reported as partial, but unlike an unreadable record it does not halt: the numbers are sound
        // and the playbook explicitly keeps this case non-blocking.
        expect(decision.dataQuality).toBe('PARTIAL');
        expect(decision.recommendation).toBe('TRADING_ALLOWED');
        expect(decision.triggeredRules).toEqual([]);
    });
});
