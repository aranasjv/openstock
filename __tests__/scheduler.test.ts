import { describe, it, expect } from 'vitest';
import { isJobDue, isDigestDue, getZonedParts } from '@/lib/scheduler';

/**
 * Due-check tests.
 *
 * These are the pure functions behind the scheduler, tested directly rather than by waiting
 * on timers — so they cover boundaries (not yet due, exactly due, already ran today, month
 * rollover) that a timing-based test could not reach reliably.
 */

const at = (iso: string) => new Date(iso);

describe('isJobDue (interval jobs)', () => {
  it('is due when it has never run', () => {
    expect(isJobDue({ now: at('2026-09-19T10:00:00Z'), lastRunAt: null, everyMinutes: 5 })).toBe(true);
  });

  it('is not due before the interval has elapsed', () => {
    expect(
      isJobDue({ now: at('2026-09-19T10:03:00Z'), lastRunAt: at('2026-09-19T10:00:00Z'), everyMinutes: 5 })
    ).toBe(false);
  });

  it('is due exactly at the interval boundary', () => {
    expect(
      isJobDue({ now: at('2026-09-19T10:05:00Z'), lastRunAt: at('2026-09-19T10:00:00Z'), everyMinutes: 5 })
    ).toBe(true);
  });

  it('is due well past the interval', () => {
    expect(
      isJobDue({ now: at('2026-09-19T12:00:00Z'), lastRunAt: at('2026-09-19T10:00:00Z'), everyMinutes: 5 })
    ).toBe(true);
  });

  it('treats a non-positive interval as never due, rather than always due', () => {
    // Guards against a bad config value causing a hot loop of API calls.
    expect(isJobDue({ now: at('2026-09-19T10:00:00Z'), lastRunAt: null, everyMinutes: 0 })).toBe(false);
    expect(isJobDue({ now: at('2026-09-19T10:00:00Z'), lastRunAt: null, everyMinutes: -1 })).toBe(false);
  });
});

describe('getZonedParts', () => {
  it('reports wall-clock time in the requested zone', () => {
    // 12:00 UTC is 20:00 in Manila (UTC+8) and 08:00 in New York (UTC-4 in September).
    const instant = at('2026-09-19T12:00:00Z');
    expect(getZonedParts(instant, 'UTC').hour).toBe(12);
    expect(getZonedParts(instant, 'Asia/Manila').hour).toBe(20);
    expect(getZonedParts(instant, 'America/New_York').hour).toBe(8);
  });

  it('rolls the date over, not just the hour', () => {
    // 22:00 UTC on the 19th is 06:00 on the 20th in Manila.
    const instant = at('2026-09-19T22:00:00Z');
    const manila = getZonedParts(instant, 'Asia/Manila');
    expect(manila.day).toBe(20);
    expect(manila.hour).toBe(6);
  });

  it('falls back to UTC for an unknown timezone instead of throwing', () => {
    const parts = getZonedParts(at('2026-09-19T12:00:00Z'), 'Not/AZone');
    expect(parts.hour).toBe(12);
  });
});

describe('isDigestDue (daily digest)', () => {
  const utc = 'UTC';

  it('is not due before the configured hour', () => {
    expect(
      isDigestDue({ now: at('2026-09-19T07:59:00Z'), lastRunAt: null, hour: 8, timezone: utc })
    ).toBe(false);
  });

  it('is due at the configured hour', () => {
    expect(
      isDigestDue({ now: at('2026-09-19T08:00:00Z'), lastRunAt: null, hour: 8, timezone: utc })
    ).toBe(true);
  });

  it('is not due again on the same local day', () => {
    expect(
      isDigestDue({ now: at('2026-09-19T18:00:00Z'), lastRunAt: at('2026-09-19T08:00:00Z'), hour: 8, timezone: utc })
    ).toBe(false);
  });

  it('is due again the next day', () => {
    expect(
      isDigestDue({ now: at('2026-09-20T08:00:00Z'), lastRunAt: at('2026-09-19T08:00:00Z'), hour: 8, timezone: utc })
    ).toBe(true);
  });

  it('catches up if the process was down over the configured hour', () => {
    // Started at 14:00 having missed 08:00 entirely: send rather than skip the day.
    expect(
      isDigestDue({ now: at('2026-09-19T14:00:00Z'), lastRunAt: at('2026-09-18T08:00:00Z'), hour: 8, timezone: utc })
    ).toBe(true);
  });

  it('does not re-send after a restart later the same day', () => {
    // The in-memory timer is gone after a restart; the persisted timestamp is what prevents
    // a duplicate send.
    expect(
      isDigestDue({ now: at('2026-09-19T23:30:00Z'), lastRunAt: at('2026-09-19T08:00:00Z'), hour: 8, timezone: utc })
    ).toBe(false);
  });

  it('respects the timezone when deciding the hour', () => {
    // 00:00 UTC is 08:00 in Manila, so the digest is due there but not in UTC.
    const instant = at('2026-09-19T00:00:00Z');
    expect(isDigestDue({ now: instant, lastRunAt: null, hour: 8, timezone: 'Asia/Manila' })).toBe(true);
    expect(isDigestDue({ now: instant, lastRunAt: null, hour: 8, timezone: 'UTC' })).toBe(false);
  });

  it('handles a month rollover', () => {
    expect(
      isDigestDue({ now: at('2026-10-01T08:00:00Z'), lastRunAt: at('2026-09-30T08:00:00Z'), hour: 8, timezone: utc })
    ).toBe(true);
  });

  it('handles a year rollover', () => {
    expect(
      isDigestDue({ now: at('2027-01-01T08:00:00Z'), lastRunAt: at('2026-12-31T08:00:00Z'), hour: 8, timezone: utc })
    ).toBe(true);
  });

  it('supports an hour of 0 (midnight)', () => {
    // Midnight is the start of the day, so with catch-up semantics any later time on that
    // day still qualifies — until it has run once.
    expect(
      isDigestDue({ now: at('2026-09-19T00:00:00Z'), lastRunAt: null, hour: 0, timezone: utc })
    ).toBe(true);
    expect(
      isDigestDue({ now: at('2026-09-19T09:00:00Z'), lastRunAt: null, hour: 0, timezone: utc })
    ).toBe(true);
    expect(
      isDigestDue({ now: at('2026-09-19T23:59:00Z'), lastRunAt: at('2026-09-19T00:05:00Z'), hour: 0, timezone: utc })
    ).toBe(false);
    expect(
      isDigestDue({ now: at('2026-09-20T00:01:00Z'), lastRunAt: at('2026-09-19T00:05:00Z'), hour: 0, timezone: utc })
    ).toBe(true);
  });

  it('never fires before the configured hour on a fresh day', () => {
    // The one thing catch-up must not do: send yesterday's schedule early.
    expect(
      isDigestDue({ now: at('2026-09-19T03:00:00Z'), lastRunAt: at('2026-09-18T08:00:00Z'), hour: 8, timezone: utc })
    ).toBe(false);
  });
});
