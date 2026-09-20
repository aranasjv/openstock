/**
 * Parser for the market-breadth CSV published by the `market-breadth-analyzer` skill's upstream
 * project (`tradermonty/market-breadth-analysis`, served from GitHub Pages).
 *
 * Pure and header-driven rather than positional: the file has seventeen columns today, and reading
 * them by index would turn a reordering upstream into silently wrong numbers rather than a missing
 * one. Every field is looked up by name and coerced, and an unparseable value becomes null instead
 * of NaN — a NaN would propagate through the composite and produce a score that looks computed.
 *
 * The split on commas is safe for this file specifically: it contains dates, numbers and
 * True/False, with no quoted fields. A general CSV would need a real parser, which is why that
 * assumption is written down rather than implied.
 */

export interface BreadthRow {
    date: string;
    sp500: number | null;
    /** Percentage of S&P 500 constituents above their 200-day average, as a 0-1 fraction. */
    breadthRaw: number | null;
    breadth200Ma: number | null;
    breadth8Ma: number | null;
    /** 1, 0 or -1: the direction of the 200-day EMA. */
    breadth200MaTrend: number | null;
    bearishSignal: boolean;
    isPeak: boolean;
    isTrough: boolean;
    /** The same series computed on the 50-day average, used by the bearish-signal component. */
    breadth50Raw: number | null;
    breadth50Ma: number | null;
    breadth50MaTrend: number | null;
    isPeak50: boolean;
    isTrough50: boolean;
}

const COLUMNS = {
    date: 'Date',
    sp500: 'S&P500_Price',
    breadthRaw: 'Breadth_Index_Raw',
    breadth200Ma: 'Breadth_Index_200MA',
    breadth8Ma: 'Breadth_Index_8MA',
    breadth200MaTrend: 'Breadth_200MA_Trend',
    bearishSignal: 'Bearish_Signal',
    isPeak: 'Is_Peak',
    isTrough: 'Is_Trough',
    breadth50Raw: 'Breadth_50_Index_Raw',
    breadth50Ma: 'Breadth_50_Index_50MA',
    breadth50MaTrend: 'Breadth_50_MA_Trend',
    isPeak50: 'Is_Peak_50',
    isTrough50: 'Is_Trough_50',
} as const;

type NumericField =
    | 'sp500'
    | 'breadthRaw'
    | 'breadth200Ma'
    | 'breadth8Ma'
    | 'breadth200MaTrend'
    | 'breadth50Raw'
    | 'breadth50Ma'
    | 'breadth50MaTrend';

const NUMERIC_FIELDS: NumericField[] = [
    'sp500',
    'breadthRaw',
    'breadth200Ma',
    'breadth8Ma',
    'breadth200MaTrend',
    'breadth50Raw',
    'breadth50Ma',
    'breadth50MaTrend',
];

const BOOLEAN_FIELDS = ['bearishSignal', 'isPeak', 'isTrough', 'isPeak50', 'isTrough50'] as const;

function toNumber(value: string | undefined): number | null {
    if (value === undefined) return null;
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
}

/** The file writes `True`/`False`; anything else is treated as absent rather than as false. */
function toBoolean(value: string | undefined): boolean {
    return value?.trim().toLowerCase() === 'true';
}

export function parseBreadthCsv(text: string): BreadthRow[] {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map((cell) => cell.trim());
    const at = (row: string[], column: string): string | undefined => {
        const index = header.indexOf(column);
        return index === -1 ? undefined : row[index];
    };

    const rows: BreadthRow[] = [];

    for (const line of lines.slice(1)) {
        const cells = line.split(',').map((cell) => cell.trim());
        const date = at(cells, COLUMNS.date);
        if (!date) continue;

        const row = { date } as unknown as Record<string, unknown>;
        for (const field of NUMERIC_FIELDS) {
            row[field] = toNumber(at(cells, COLUMNS[field]));
        }
        for (const field of BOOLEAN_FIELDS) {
            row[field] = toBoolean(at(cells, COLUMNS[field]));
        }

        rows.push(row as unknown as BreadthRow);
    }

    // The upstream file is chronological; sorting here means a consumer never has to assume it.
    return rows.sort((left, right) => left.date.localeCompare(right.date));
}

/** `Metric,Value` pairs from the summary file, as a plain map. */
export function parseBreadthSummary(text: string): Record<string, string> {
    const summary: Record<string, string> = {};

    for (const line of text.split(/\r?\n/).slice(1)) {
        const separator = line.indexOf(',');
        if (separator === -1) continue;
        const key = line.slice(0, separator).trim();
        if (key) summary[key] = line.slice(separator + 1).trim();
    }

    return summary;
}
