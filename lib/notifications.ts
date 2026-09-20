import { escapeTelegramHtml } from '@/lib/telegram';

/**
 * Message formatting for Telegram.
 *
 * All interpolated values pass through escapeTelegramHtml — Telegram's HTML parser rejects
 * the whole message on an unescaped & or <, and company names contain them routinely
 * ("AT&T", "Barnes & Noble").
 *
 * Kept free of data-fetching so the formatting is unit-testable on its own.
 */

export interface DigestPick {
    symbol: string;
    name: string;
    score: number;
    price: number;
    isCrypto: boolean;
}

export interface DigestHolding {
    symbol: string;
    quantity: number;
    pnlPercent: number | null;
    marketValue: number | null;
}

export interface DigestInput {
    /** Pre-formatted date, e.g. 2026-09-19. */
    date: string;
    strategyName: string;
    stockPicks: DigestPick[];
    cryptoPicks: DigestPick[];
    holdings: DigestHolding[];
    totalValue: number;
    totalPnlPercent: number;
    /** Optional AI-written line; omitted when the feature is off. */
    commentary?: string;
    currency?: (value: number, isCrypto: boolean) => string;
}

const DISCLAIMER = 'Rule-based technical screen, not investment advice.';

function defaultCurrency(value: number, isCrypto: boolean): string {
    return isCrypto
        ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 6 })}`
        : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderPicks(title: string, picks: DigestPick[], currency: (v: number, c: boolean) => string): string[] {
    if (picks.length === 0) return [`<b>${title}</b>`, 'No matches right now.'];

    return [
        `<b>${title}</b>`,
        ...picks.map(
            (pick, index) =>
                `${index + 1}. ${escapeTelegramHtml(pick.name)} — score ${pick.score}, ${currency(pick.price, pick.isCrypto)}`
        ),
    ];
}

/**
 * The daily digest body.
 *
 * The stock and crypto halves are returned as separate message strings because they are
 * delivered to separate chats.
 */
export function buildDigestMessages(input: DigestInput): { stocks: string; crypto: string } {
    const currency = input.currency ?? defaultCurrency;

    const header = [
        `<b>OpenStock — must-buy screen</b>`,
        escapeTelegramHtml(input.date),
        `Strategy: ${escapeTelegramHtml(input.strategyName)}`,
        '',
    ];

    // Escaped like every other interpolated value — commentary is AI-written prose and
    // routinely contains "&" or "<".
    const commentaryLines = input.commentary ? [escapeTelegramHtml(input.commentary), ''] : [];

    const stocks = [
        ...header,
        ...renderPicks('Stocks', input.stockPicks, currency),
        '',
        ...commentaryLines,
        DISCLAIMER,
    ].join('\n');

    const holdingsLines: string[] = [];
    if (input.holdings.length > 0) {
        holdingsLines.push('<b>Holdings</b>');
        holdingsLines.push(
            `Total ${currency(input.totalValue, false)} (${input.totalPnlPercent >= 0 ? '+' : ''}${input.totalPnlPercent.toFixed(2)}%)`
        );
        for (const holding of input.holdings) {
            const pnl =
                holding.pnlPercent === null
                    ? 'n/a'
                    : `${holding.pnlPercent >= 0 ? '+' : ''}${holding.pnlPercent.toFixed(1)}%`;
            holdingsLines.push(`${escapeTelegramHtml(holding.symbol)} ${holding.quantity} — ${pnl}`);
        }
        holdingsLines.push('');
    } else {
        holdingsLines.push('No holdings tracked yet.', '');
    }

    const crypto = [
        ...header,
        ...renderPicks('Crypto', input.cryptoPicks, currency),
        '',
        ...holdingsLines,
        ...commentaryLines,
        DISCLAIMER,
    ].join('\n');

    return { stocks, crypto };
}

export interface TriggeredAlert {
    symbol: string;
    condition: 'ABOVE' | 'BELOW';
    targetPrice: number;
    currentPrice: number;
    isCrypto: boolean;
}

/**
 * Triggered alerts as one combined message per audience.
 *
 * Combined rather than one message per alert: Telegram allows roughly one message per second
 * per chat, and a burst of individual messages is both rate-limit prone and unpleasant to read.
 */
export function buildAlertMessage(alerts: TriggeredAlert[]): string | null {
    if (alerts.length === 0) return null;

    const lines = ['<b>Price alerts triggered</b>'];
    for (const alert of alerts) {
        lines.push(
            `${escapeTelegramHtml(alert.symbol)} crossed ${alert.condition === 'ABOVE' ? 'above' : 'below'} ` +
                `${alert.targetPrice} — now ${alert.currentPrice}`
        );
    }

    return lines.join('\n');
}
