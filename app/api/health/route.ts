import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/database/mongoose';
import { getJobState, JOB_ALERTS, JOB_DIGEST } from '@/lib/scheduler';
import { listAnalysisSkills } from '@/lib/analysis-skills';

/**
 * Liveness and readiness probe.
 *
 * `/api/health` answers two questions a container orchestrator (or a human) needs:
 *   - is the process up and can it reach MongoDB?
 *   - did the scheduled jobs last run, and did they succeed?
 *
 * It is deliberately public — the middleware matcher excludes `/api/*` — so it must never
 * echo configuration. Nothing here returns a connection string, key or raw driver error;
 * a failure is reported as a status, not as the message that produced it, because driver
 * errors routinely embed the URI (credentials included).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** A probe that hangs is a failed probe; do not let a stalled DB connect stall the check. */
const DB_CHECK_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('health: database check timed out')), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

export async function GET() {
    const startedAt = Date.now();

    let db: 'up' | 'down' = 'down';
    let jobs: {
        alerts: { lastRunAt: string | null; status: string | null; error: string | null };
        digest: { lastRunAt: string | null; status: string | null; error: string | null };
    } = {
        alerts: { lastRunAt: null, status: null, error: null },
        digest: { lastRunAt: null, status: null, error: null },
    };

    try {
        await withTimeout(
            (async () => {
                const mongoose = await connectToDatabase();
                await mongoose.connection.db?.admin().ping();
            })(),
            DB_CHECK_TIMEOUT_MS
        );
        db = 'up';

        const [alerts, digest] = await Promise.all([getJobState(JOB_ALERTS), getJobState(JOB_DIGEST)]);
        jobs = {
            alerts: {
                lastRunAt: alerts.lastRunAt?.toISOString() ?? null,
                status: alerts.lastStatus,
                error: alerts.lastError,
            },
            digest: {
                lastRunAt: digest.lastRunAt?.toISOString() ?? null,
                status: digest.lastStatus,
                error: digest.lastError,
            },
        };
    } catch (error) {
        // Logged server-side only; the response stays free of driver internals.
        console.error('Health check failed to reach MongoDB:', error);
    }

    // The playbooks are read from disk, and a deployment that forgot to ship .agents is a
    // degraded but valid state — reporting the count makes that visible instead of silent.
    const analysisSkills = await listAnalysisSkills().catch(() => []);

    return NextResponse.json(
        {
            ok: db === 'up',
            service: 'openstock',
            time: new Date().toISOString(),
            uptimeSeconds: Math.round(process.uptime()),
            db,
            checkLatencyMs: Date.now() - startedAt,
            analysisPlaybooks: {
                count: analysisSkills.length,
                ids: analysisSkills.map((skill) => skill.id),
            },
            jobs,
        },
        { status: db === 'up' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
    );
}
