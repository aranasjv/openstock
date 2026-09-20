import { describe, it, expect } from 'vitest';
import { parseBreadthCsv, parseBreadthSummary } from '@/lib/breadth-csv';

const HEADER =
    'Date,S&P500_Price,Breadth_Index_Raw,Breadth_Index_200MA,Breadth_Index_8MA,Breadth_200MA_Trend,' +
    'Bearish_Signal,Is_Peak,Is_Trough,Is_Trough_8MA_Below_04,Breadth_50_Index_Raw,Breadth_50_Index_50MA,' +
    'Breadth_50_Index_8MA,Breadth_50_MA_Trend,Bearish_Signal_50,Is_Peak_50,Is_Trough_50';

const ROW_A = '2026-09-16,752.18,0.53,0.63,0.59,1,False,False,True,False,0.32,0.54,0.39,-1,True,False,False';
const ROW_B = '2026-09-17,762.6,0.53,0.63,0.58,1,False,False,False,False,0.31,0.53,0.37,-1,True,False,False';

describe('parseBreadthCsv', () => {
    it('maps the documented columns onto a typed row', () => {
        const rows = parseBreadthCsv(`${HEADER}\n${ROW_A}\n${ROW_B}`);

        expect(rows).toHaveLength(2);
        expect(rows[1]).toEqual({
            date: '2026-09-17',
            sp500: 762.6,
            breadthRaw: 0.53,
            breadth200Ma: 0.63,
            breadth8Ma: 0.58,
            breadth200MaTrend: 1,
            bearishSignal: false,
            isPeak: false,
            isTrough: false,
            breadth50Raw: 0.31,
            breadth50Ma: 0.53,
            breadth50MaTrend: -1,
            // `Bearish_Signal_50` is True in this row and `Is_Peak_50` is False — so this pair is
            // what catches a parser reading the adjacent column instead of the named one.
            isPeak50: false,
            isTrough50: false,
        });
    });

    it('reads by column name, so an upstream reorder cannot shift the numbers', () => {
        // The same two columns, swapped. Positional parsing would put the price in the date.
        const reordered = 'S&P500_Price,Date\n752.18,2026-09-16';
        const rows = parseBreadthCsv(reordered);

        expect(rows[0].date).toBe('2026-09-16');
        expect(rows[0].sp500).toBe(752.18);
    });

    it('turns an unparseable number into null rather than NaN', () => {
        // A NaN would propagate through the composite and yield a score that looks computed.
        const broken = ROW_A.replace('0.53,0.63', 'n/a,0.63');
        const rows = parseBreadthCsv(`${HEADER}\n${broken}`);

        expect(rows[0].breadthRaw).toBeNull();
        expect(rows[0].breadth200Ma).toBe(0.63);
    });

    it('treats only True as true', () => {
        const rows = parseBreadthCsv(`${HEADER}\n${ROW_A}`);

        expect(rows[0].isTrough).toBe(true);
        expect(rows[0].isPeak).toBe(false);
        // `Is_Trough_8MA_Below_04` is present in the file but not modelled; it must not be mistaken
        // for the `isTrough` column.
        expect(rows[0].isPeak50).toBe(false);
        expect(rows[0].isTrough50).toBe(false);
    });

    it('sorts oldest first even when the file is reversed', () => {
        const rows = parseBreadthCsv(`${HEADER}\n${ROW_B}\n${ROW_A}`);

        expect(rows.map((row) => row.date)).toEqual(['2026-09-16', '2026-09-17']);
    });

    it('ignores blank trailing lines', () => {
        expect(parseBreadthCsv(`${HEADER}\n${ROW_A}\n\n  \n`)).toHaveLength(1);
    });

    it('returns nothing for a body with no rows or no header', () => {
        expect(parseBreadthCsv('')).toEqual([]);
        expect(parseBreadthCsv(HEADER)).toEqual([]);
    });

    it('skips a row with no date rather than inventing one', () => {
        expect(parseBreadthCsv(`${HEADER}\n,752.18,0.53,0.63,0.59,1,False,False,False,False,0.3,0.5,0.4,-1,True,False,False`)).toEqual(
            []
        );
    });
});

describe('parseBreadthSummary', () => {
    it('reads the metric/value pairs', () => {
        const summary = parseBreadthSummary(
            'Metric,Value\nAnalysis Period Start,2016-09-20\nTotal Trading Days,2512\n'
        );

        expect(summary['Analysis Period Start']).toBe('2016-09-20');
        expect(summary['Total Trading Days']).toBe('2512');
    });

    it('keeps commas inside a value, since only the first one is a separator', () => {
        const summary = parseBreadthSummary('Metric,Value\nNote,first, second\n');

        expect(summary.Note).toBe('first, second');
    });
});
