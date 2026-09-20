'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Trash2, Plus } from 'lucide-react';
import { addHolding, removeHolding } from '@/lib/actions/holdings.actions';
import { searchStocks } from '@/lib/actions/finnhub.actions';
import { searchCrypto } from '@/lib/actions/crypto.actions';
import { formatCryptoPrice, formatPrice } from '@/lib/utils';

export interface HoldingRow {
    symbol: string;
    assetType: 'stock' | 'crypto';
    quantity: number;
    averageCost: number;
    price: number | null;
    marketValue: number | null;
    costBasis: number;
    pnl: number | null;
    pnlPercent: number | null;
}

interface HoldingsManagerProps {
    holdings: HoldingRow[];
}

interface Suggestion {
    value: string;
    label: string;
}

export default function HoldingsManager({ holdings }: HoldingsManagerProps) {
    const [assetType, setAssetType] = useState<'stock' | 'crypto'>('stock');
    const [symbol, setSymbol] = useState('');
    const [quantity, setQuantity] = useState('');
    const [averageCost, setAverageCost] = useState('');
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [pending, startTransition] = useTransition();

    // Suggestions come from the same search used elsewhere, so symbols are always valid.
    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                if (assetType === 'crypto') {
                    const coins = await searchCrypto();
                    if (!cancelled) {
                        setSuggestions(coins.slice(0, 50).map((c) => ({ value: c.id, label: `${c.name} (${c.symbol})` })));
                    }
                } else {
                    const stocks = await searchStocks();
                    if (!cancelled) {
                        setSuggestions(stocks.map((s) => ({ value: s.symbol, label: s.name })));
                    }
                }
            } catch {
                if (!cancelled) setSuggestions([]);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [assetType]);

    const handleAdd = () => {
        if (!symbol.trim() || !quantity.trim() || !averageCost.trim()) {
            toast.error('Symbol, quantity and average cost are all required.');
            return;
        }

        startTransition(async () => {
            try {
                await addHolding({
                    symbol: symbol.trim(),
                    assetType,
                    quantity: Number.parseFloat(quantity),
                    averageCost: Number.parseFloat(averageCost),
                });
                toast.success(`${symbol.trim().toUpperCase()} saved.`);
                setSymbol('');
                setQuantity('');
                setAverageCost('');
            } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Could not save holding.');
            }
        });
    };

    const handleRemove = (row: HoldingRow) => {
        startTransition(async () => {
            try {
                await removeHolding(row.symbol, row.assetType);
                toast.success(`${row.symbol} removed.`);
            } catch {
                toast.error('Could not remove holding.');
            }
        });
    };

    const formatMoney = (value: number, type: 'stock' | 'crypto') =>
        type === 'crypto' ? formatCryptoPrice(value) : formatPrice(value);

    return (
        <div className="space-y-6">
            {/* Add form */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">
                    Add a holding
                </h3>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <select
                        value={assetType}
                        onChange={(e) => {
                            setAssetType(e.target.value as 'stock' | 'crypto');
                            setSymbol('');
                        }}
                        className="h-9 rounded-md border border-gray-800 bg-[#1C1C1F] px-3 text-sm text-white"
                    >
                        <option value="stock">Stock</option>
                        <option value="crypto">Crypto</option>
                    </select>

                    <input
                        list="holding-symbols"
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value)}
                        placeholder={assetType === 'crypto' ? 'bitcoin' : 'AAPL'}
                        className="h-9 rounded-md border border-gray-800 bg-[#1C1C1F] px-3 font-mono text-sm text-white placeholder:text-gray-500"
                    />
                    <datalist id="holding-symbols">
                        {suggestions.map((s) => (
                            <option key={s.value} value={s.value}>
                                {s.label}
                            </option>
                        ))}
                    </datalist>

                    <input
                        type="number"
                        step="any"
                        min="0"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="Quantity"
                        className="h-9 rounded-md border border-gray-800 bg-[#1C1C1F] px-3 text-sm text-white placeholder:text-gray-500"
                    />

                    <div className="flex gap-2">
                        <input
                            type="number"
                            step="any"
                            min="0"
                            value={averageCost}
                            onChange={(e) => setAverageCost(e.target.value)}
                            placeholder="Avg cost"
                            className="h-9 w-full rounded-md border border-gray-800 bg-[#1C1C1F] px-3 text-sm text-white placeholder:text-gray-500"
                        />
                        <Button
                            type="button"
                            onClick={handleAdd}
                            disabled={pending}
                            aria-label="Add holding"
                            className="h-9 shrink-0 bg-teal-600 px-3 text-white hover:bg-teal-500"
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <p className="mt-2 text-[11px] text-gray-500">
                    Average cost is the blended price per unit, used to compute profit and loss.
                </p>
            </div>

            {/* Holdings table */}
            {holdings.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-sm">
                            <thead>
                                <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-500">
                                    <th className="px-4 py-3 font-medium">Asset</th>
                                    <th className="px-4 py-3 text-right font-medium">Quantity</th>
                                    <th className="px-4 py-3 text-right font-medium">Avg cost</th>
                                    <th className="px-4 py-3 text-right font-medium">Price</th>
                                    <th className="px-4 py-3 text-right font-medium">Value</th>
                                    <th className="px-4 py-3 text-right font-medium">P&amp;L</th>
                                    <th className="px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody>
                                {holdings.map((row) => (
                                    <tr key={`${row.assetType}:${row.symbol}`} className="border-b border-gray-800/60 last:border-0">
                                        <td className="px-4 py-3">
                                            <span className="font-medium text-gray-100">{row.symbol}</span>
                                            <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                                                {row.assetType === 'crypto' ? 'coin' : 'stock'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-300">{row.quantity}</td>
                                        <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-300">
                                            {formatMoney(row.averageCost, row.assetType)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-300">
                                            {row.price === null ? (
                                                <span className="text-yellow-600">n/a</span>
                                            ) : (
                                                formatMoney(row.price, row.assetType)
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-100">
                                            {row.marketValue === null ? '—' : formatMoney(row.marketValue, row.assetType)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {row.pnl === null ? (
                                                <span className="text-gray-500">—</span>
                                            ) : (
                                                <span className={row.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                                    {row.pnl >= 0 ? '+' : ''}
                                                    {formatMoney(row.pnl, row.assetType)}
                                                    {row.pnlPercent !== null ? ` (${row.pnlPercent.toFixed(1)}%)` : ''}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                type="button"
                                                onClick={() => handleRemove(row)}
                                                disabled={pending}
                                                title="Remove holding"
                                                aria-label={`Remove ${row.symbol}`}
                                                className="text-gray-500 transition-colors hover:text-red-400"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-8 text-center text-sm text-gray-500">
                    No holdings yet. Add a stock or a coin above to track its value and profit or loss.
                </div>
            )}
        </div>
    );
}
