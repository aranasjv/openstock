'use client';

import React, { memo, useState, useEffect } from 'react';
import useTradingViewWidget from "@/hooks/useTradingViewWidget";
import { cn } from "@/lib/utils";
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TradingViewWidgetProps {
    title?: string;
    scriptUrl: string;
    config: Record<string, unknown>;
    height?: number;
    /**
     * Fill the parent container instead of using a fixed pixel height. Use when the widget
     * sits in a grid cell whose height is set by the layout, so panels in the same row match.
     */
    fill?: boolean;
    className?: string;
    allowExpand?: boolean;
}

const TradingViewWidget = ({
    title,
    scriptUrl,
    config,
    height = 600,
    fill = false,
    className,
    allowExpand = false,
}: TradingViewWidgetProps) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [windowHeight, setWindowHeight] = useState(0);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setWindowHeight(window.innerHeight);
            const handleResize = () => setWindowHeight(window.innerHeight);
            window.addEventListener('resize', handleResize);
            return () => window.removeEventListener('resize', handleResize);
        }
    }, []);

    const currentHeight = isExpanded ? windowHeight : height;

    const widgetConfig = {
        ...config,
        height: currentHeight,
        width: "100%",
        autosize: true,
    };

    const grows = fill || isExpanded;
    const containerRef = useTradingViewWidget(scriptUrl, widgetConfig, currentHeight);

    const toggleExpand = () => {
        setIsExpanded(!isExpanded);
    };

    return (
        <div
            className={cn(
                "w-full transition-all duration-300",
                fill && !isExpanded && "h-full min-h-0",
                isExpanded && "fixed inset-0 z-[9999] bg-background"
            )}
        >
            <div className={cn("w-full relative group", grows && "h-full flex flex-col")}>
                {title && !isExpanded && (
                    <h3 className="shrink-0 text-sm font-semibold text-gray-200 mb-2">{title}</h3>
                )}

                {allowExpand && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleExpand}
                        className={cn(
                            "absolute top-2 right-2 z-10 hover:bg-background/50 text-muted-foreground hover:text-foreground transition-all duration-200",
                            !isExpanded ? "opacity-0 group-hover:opacity-100" : "bg-background/20"
                        )}
                        title={isExpanded ? "Minimize" : "Click to expand"}
                    >
                        {isExpanded ? <Minimize2 className="h-6 w-6" /> : <Maximize2 className="h-6 w-6" />}
                    </Button>
                )}

                <div
                    className={cn(
                        'tradingview-widget-container',
                        className,
                        // The hook renders the widget at 100% height when autosize is on, so
                        // this container is what actually determines the rendered size.
                        grows && "h-full min-h-0 overflow-hidden rounded-xl"
                    )}
                    ref={containerRef}
                >
                    <div
                        className="tradingview-widget-container__widget"
                        style={{ height: grows ? '100%' : currentHeight, width: "100%" }}
                    />
                </div>
            </div>
        </div>
    );
}

export default memo(TradingViewWidget);
