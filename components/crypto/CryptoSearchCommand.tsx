"use client"

import { useEffect, useState } from "react"
import { CommandDialog, CommandEmpty, CommandInput, CommandList } from "@/components/ui/command"
import { Coins, Loader2 } from "lucide-react";
import Link from "next/link";
import { searchCrypto } from "@/lib/actions/crypto.actions";
import { useDebounce } from "@/hooks/useDebounce";

interface CryptoSearchCommandProps {
    renderAs?: 'button' | 'text';
    label?: string;
    initialCoins: CryptoCoinWithWatchlistStatus[];
    /**
     * Overrides the button styling. The default `.search-btn` is a large solid button sized for
     * the mobile nav; the dashboards pass a compact chip so it matches the "Ask AI" control it
     * sits beside, rather than being the loudest thing in the header.
     */
    className?: string;
}

export default function CryptoSearchCommand({
    renderAs = 'button',
    label = 'Add crypto',
    initialCoins,
    className,
}: CryptoSearchCommandProps) {
    const [open, setOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [loading, setLoading] = useState(false)
    const [coins, setCoins] = useState<CryptoCoinWithWatchlistStatus[]>(initialCoins);

    const isSearchMode = !!searchTerm.trim();
    const displayCoins = isSearchMode ? coins : coins?.slice(0, 10);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            // Shift+Cmd/Ctrl+K to avoid colliding with the stock search shortcut.
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
                e.preventDefault()
                setOpen(v => !v)
            }
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [])

    const handleSearch = async () => {
        if (!isSearchMode) return setCoins(initialCoins);

        setLoading(true)
        try {
            const results = await searchCrypto(searchTerm.trim());
            setCoins(results);
        } catch {
            setCoins([])
        } finally {
            setLoading(false)
        }
    }

    const debouncedSearch = useDebounce(handleSearch, 300);

    useEffect(() => {
        debouncedSearch();
    }, [debouncedSearch, searchTerm]);

    const handleSelectCoin = () => {
        setOpen(false);
        setSearchTerm("");
        setCoins(initialCoins);
    }

    return (
        <>
            {renderAs === 'text' ? (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="search-text"
                >
                    {label}
                </button>
            ) : (
                // Plain button for the same reason as the stock search: the shadcn <Button>'s
                // default variant paints `bg-primary`, near-white in dark mode, which beats a
                // className that only sets a border and text colour.
                <button type="button" onClick={() => setOpen(true)} className={className ?? "search-btn"}>
                    {label}
                </button>
            )}
            <CommandDialog open={open} onOpenChange={setOpen} className="search-dialog">
                <div className="search-field">
                    <CommandInput
                        value={searchTerm}
                        onValueChange={setSearchTerm}
                        placeholder="Search crypto..."
                        className="search-input"
                    />
                    {loading && <Loader2 className="search-loader" />}
                </div>
                <CommandList className="search-list">
                    {loading ? (
                        <CommandEmpty className="search-list-empty">Loading coins...</CommandEmpty>
                    ) : displayCoins?.length === 0 ? (
                        <div className="search-list-indicator">
                            {isSearchMode ? 'No results found' : 'No coins available'}
                        </div>
                    ) : (
                        <ul>
                            <div className="search-count">
                                {isSearchMode ? 'Search results' : 'Top coins'}
                                {` `}({displayCoins?.length || 0})
                            </div>
                            {displayCoins?.map((coin) => (
                                <li key={coin.id} className="search-item">
                                    <Link
                                        href={`/crypto/${coin.id}`}
                                        onClick={handleSelectCoin}
                                        className="search-item-link"
                                    >
                                        {coin.image ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={coin.image}
                                                alt={coin.name}
                                                className="h-4 w-4 rounded-full"
                                            />
                                        ) : (
                                            <Coins className="h-4 w-4 text-gray-500" />
                                        )}
                                        <div className="flex-1">
                                            <div className="search-item-name">
                                                {coin.name}
                                            </div>
                                            <div className="text-sm text-gray-500">
                                                {[coin.symbol, coin.marketCapRank ? `#${coin.marketCapRank}` : null]
                                                    .filter(Boolean)
                                                    .join(' | ')}
                                            </div>
                                        </div>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )
                    }
                </CommandList>
            </CommandDialog>
        </>
    )
}
