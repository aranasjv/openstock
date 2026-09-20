import 'server-only';

import { connectToDatabase } from '@/database/mongoose';
import { loadConfig, getConfigNumber } from '@/lib/config';

/**
 * A small in-process scheduler.
 *
 * Deliberately not node-cron: the due-check is a pure function over timestamps, which is
 * both dependency-free and unit-testable without waiting on real time.
 *
 * Last-run timestamps are persisted in MongoDB rather than held in memory. That is what
 * stops a container restart from re-sending the digest — the process is expected to restart
 * (every deploy does), so in-memory state alone would mean duplicate sends.
 */

const JOB_STATE_COLLECTION = 'jobstate';
const TICK_INTERVAL_MS = 60_000;

export interface ZonedParts {
    year: number;
    month: number;
    day: number;
    /** 0-23 */
    hour: number;
}

/**
 * Wall-clock parts of an instant in a given IANA timezone.
 * The container clock is UTC, so the configured timezone is the source of truth for "8am".
 */
export function getZonedParts(date: Date, timezone: string): ZonedParts {
    let formatter: Intl.DateTimeFormat;

    try {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            // h23 avoids the "24" that some locales emit for midnight.
            hourCycle: 'h23',
        });
    } catch {
        // Unknown timezone: fall back to UTC rather than throwing inside a cron tick.
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hourCycle: 'h23',
        });
    }

    const parts = formatter.formatToParts(date);
    const read = (type: string) => Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);

    return {
        year: read('year'),
        month: read('month'),
        day: read('day'),
        hour: read('hour'),
    };
}

function isSameLocalDay(a: ZonedParts, b: ZonedParts): boolean {
    return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Interval jobs (alerts): due once `everyMinutes` has elapsed. */
export function isJobDue({
    now,
    lastRunAt,
    everyMinutes,
}: {
    now: Date;
    lastRunAt: Date | null;
    everyMinutes: number;
}): boolean {
    if (everyMinutes <= 0) return false;
    if (!lastRunAt) return true;
    return now.getTime() - lastRunAt.getTime() >= everyMinutes * 60_000;
}

/**
 * Daily digest: due at or after `hour` in `timezone`, once per local day.
 *
 * "At or after" rather than "exactly at" so a restart or a missed tick still sends, instead
 * of silently skipping the whole day.
 */
export function isDigestDue({
    now,
    lastRunAt,
    hour,
    timezone,
}: {
    now: Date;
    lastRunAt: Date | null;
    hour: number;
    timezone: string;
}): boolean {
    const localNow = getZonedParts(now, timezone);

    if (localNow.hour < hour) return false;
    if (!lastRunAt) return true;

    return !isSameLocalDay(localNow, getZonedParts(lastRunAt, timezone));
}

// ── Persisted job state ────────────────────────────────────────────

export async function getLastRun(job: string): Promise<Date | null> {
    try {
        const mongoose = await connectToDatabase();
        const doc = await mongoose.connection.db
            ?.collection(JOB_STATE_COLLECTION)
            .findOne({ key: job });
        const value = doc?.lastRunAt;
        return value ? new Date(value as string | Date) : null;
    } catch (error) {
        console.error(`Scheduler: could not read last run for ${job}:`, error);
        return null;
    }
}

export async function setLastRun(job: string, at: Date = new Date()): Promise<void> {
    try {
        const mongoose = await connectToDatabase();
        await mongoose.connection.db
            ?.collection(JOB_STATE_COLLECTION)
            .updateOne({ key: job }, { $set: { lastRunAt: at } }, { upsert: true });
    } catch (error) {
        console.error(`Scheduler: could not record last run for ${job}:`, error);
    }
}

export interface JobState {
    lastRunAt: Date | null;
    lastStatus: 'ok' | 'error' | null;
    lastError: string | null;
    lastDurationMs: number | null;
}

const EMPTY_JOB_STATE: JobState = {
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    lastDurationMs: null,
};

/** Read a job's persisted state. Used by the health endpoint to expose job health. */
export async function getJobState(job: string): Promise<JobState> {
    try {
        const mongoose = await connectToDatabase();
        const doc = await mongoose.connection.db
            ?.collection(JOB_STATE_COLLECTION)
            .findOne({ key: job });
        if (!doc) return EMPTY_JOB_STATE;

        return {
            lastRunAt: doc.lastRunAt ? new Date(doc.lastRunAt as string | Date) : null,
            lastStatus: doc.lastStatus === 'ok' || doc.lastStatus === 'error' ? doc.lastStatus : null,
            lastError: typeof doc.lastError === 'string' && doc.lastError ? doc.lastError : null,
            lastDurationMs: typeof doc.lastDurationMs === 'number' ? doc.lastDurationMs : null,
        };
    } catch (error) {
        console.error(`Scheduler: could not read state for ${job}:`, error);
        return EMPTY_JOB_STATE;
    }
}

/**
 * Record and log how a job finished.
 *
 * The jobs used to be silent on success and log only on failure, so a digest that quietly
 * stopped sending looked identical to one with nothing to send. Logging both outcomes makes
 * "did it run, and did it work" answerable from the logs alone.
 */
export async function recordJobOutcome(
    job: string,
    outcome: { ok: boolean; detail?: string; durationMs: number }
): Promise<void> {
    console.log(
        `${outcome.ok ? '✅' : '❌'} Job "${job}" ${outcome.ok ? 'succeeded' : 'failed'} in ` +
            `${outcome.durationMs}ms${outcome.detail ? ` — ${outcome.detail}` : ''}`
    );

    try {
        const mongoose = await connectToDatabase();
        await mongoose.connection.db?.collection(JOB_STATE_COLLECTION).updateOne(
            { key: job },
            {
                $set: {
                    lastStatus: outcome.ok ? 'ok' : 'error',
                    lastError: outcome.ok ? '' : outcome.detail ?? 'Job failed',
                    lastDurationMs: outcome.durationMs,
                    lastFinishedAt: new Date(),
                },
            },
            { upsert: true }
        );
    } catch (error) {
        console.error(`Scheduler: could not record outcome for ${job}:`, error);
    }
}

// ── Runner ─────────────────────────────────────────────────────────

export const JOB_ALERTS = 'alerts';
export const JOB_DIGEST = 'digest';

let running = false;

/**
 * One scheduler tick: evaluate which jobs are due and run them.
 * Exported so it can be triggered manually and tested.
 */
export async function runDueJobs(now: Date = new Date()): Promise<{ ran: string[] }> {
    const ran: string[] = [];

    const config = await loadConfig();
    const alertMinutes = await getConfigNumber('ALERT_CHECK_MINUTES', 5);
    const digestHour = await getConfigNumber('DIGEST_HOUR', 8);
    const timezone = config.DIGEST_TIMEZONE || 'UTC';
    const digestEnabled = (config.DIGEST_ENABLED || 'true') !== 'false';

    // Alerts
    try {
        const lastAlerts = await getLastRun(JOB_ALERTS);
        if (isJobDue({ now, lastRunAt: lastAlerts, everyMinutes: alertMinutes })) {
            await setLastRun(JOB_ALERTS, now);
            const started = Date.now();
            let outcome = { ok: true, detail: '' };
            try {
                const { runAlertCheck } = await import('@/lib/jobs/alert-check');
                const result = await runAlertCheck();
                outcome = { ok: true, detail: `${result.processed} active, ${result.triggered} triggered` };
            } catch (error) {
                console.error('Scheduler: alert check failed:', error);
                outcome = {
                    ok: false,
                    detail: error instanceof Error ? error.message : 'Alert check failed',
                };
            }
            await recordJobOutcome(JOB_ALERTS, { ...outcome, durationMs: Date.now() - started });
            ran.push(JOB_ALERTS);
        }
    } catch (error) {
        console.error('Scheduler: alert check failed:', error);
    }

    // Daily digest
    if (digestEnabled) {
        try {
            const lastDigest = await getLastRun(JOB_DIGEST);
            if (isDigestDue({ now, lastRunAt: lastDigest, hour: digestHour, timezone })) {
                await setLastRun(JOB_DIGEST, now);
                const started = Date.now();
                let outcome = { ok: true, detail: '' };
                try {
                    const { runDailyDigest } = await import('@/lib/jobs/daily-digest');
                    const result = await runDailyDigest();
                    outcome = {
                        ok: result.ok,
                        detail: `picks stocks=${result.pickCounts.stocks} crypto=${result.pickCounts.crypto}, sent stocks=${result.sent.stocks} crypto=${result.sent.crypto}`,
                    };
                } catch (error) {
                    console.error('Scheduler: digest failed:', error);
                    outcome = {
                        ok: false,
                        detail: error instanceof Error ? error.message : 'Digest failed',
                    };
                }
                await recordJobOutcome(JOB_DIGEST, { ...outcome, durationMs: Date.now() - started });
                ran.push(JOB_DIGEST);
            }
        } catch (error) {
            console.error('Scheduler: digest failed:', error);
        }
    }

    return { ran };
}

/**
 * Start the interval. Safe to call more than once — subsequent calls are ignored so a hot
 * reload cannot stack timers.
 */
export function startScheduler(): void {
    if (running) return;
    running = true;

    console.log(`⏱  Scheduler started (tick every ${TICK_INTERVAL_MS / 1000}s)`);

    const timer = setInterval(() => {
        void runDueJobs().catch((error) => console.error('Scheduler tick failed:', error));
    }, TICK_INTERVAL_MS);

    // Do not hold the process open purely for the timer.
    timer.unref?.();

    // Catch up immediately, so a container that was down over the digest hour still sends.
    void runDueJobs().catch((error) => console.error('Scheduler initial run failed:', error));
}
