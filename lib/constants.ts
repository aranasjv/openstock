export const NAV_ITEMS = [
    { href: '/', label: 'Stocks Dashboard' },
    { href: '/search', label: 'Search' },
    { href: '/crypto-search', label: 'Crypto Search' },
    { href: '/crypto', label: 'Crypto Dashboard' },
    { href: '/journal', label: 'Journal' },
    { href: '/assistant', label: 'Assistant' },
    { href: '/watchlist', label: 'Watchlist' },
    { href: '/holdings', label: 'Holdings' },
    { href: '/settings', label: 'Settings' },
    { href: '/api-docs', label: 'API Docs' },
];

// NAV_ITEMS entries that open a search palette instead of navigating to a route.
// There are no pages at these paths; NavItems intercepts them.
export const SEARCH_PALETTE_ITEMS: Record<string, 'stock' | 'crypto'> = {
    '/search': 'stock',
    '/crypto-search': 'crypto',
};

// Sign-up form select options
export const INVESTMENT_GOALS = [
    { value: 'Growth', label: 'Growth' },
    { value: 'Income', label: 'Income' },
    { value: 'Balanced', label: 'Balanced' },
    { value: 'Conservative', label: 'Conservative' },
];

export const RISK_TOLERANCE_OPTIONS = [
    { value: 'Low', label: 'Low' },
    { value: 'Medium', label: 'Medium' },
    { value: 'High', label: 'High' },
];

export const PREFERRED_INDUSTRIES = [
    { value: 'Technology', label: 'Technology' },
    { value: 'Healthcare', label: 'Healthcare' },
    { value: 'Finance', label: 'Finance' },
    { value: 'Energy', label: 'Energy' },
    { value: 'Consumer Goods', label: 'Consumer Goods' },
];

export const ALERT_TYPE_OPTIONS = [
    { value: 'upper', label: 'Upper' },
    { value: 'lower', label: 'Lower' },
];

export const CONDITION_OPTIONS = [
    { value: 'greater', label: 'Greater than (>)' },
    { value: 'less', label: 'Less than (<)' },
];

// TradingView Charts
export const MARKET_OVERVIEW_WIDGET_CONFIG = {
    colorTheme: 'dark', // dark mode
    dateRange: '12M', // last 12 months
    locale: 'en', // language
    largeChartUrl: '', // link to a large chart if needed
    isTransparent: false,
    showFloatingTooltip: true, // show tooltip on hover
    plotLineColorGrowing: '#0FEDBE', // line color when price goes up
    plotLineColorFalling: '#0FEDBE', // line color when price falls
    gridLineColor: 'rgba(240, 243, 250, 0)', // grid line color
    scaleFontColor: '#DBDBDB', // font color for scale
    belowLineFillColorGrowing: 'rgba(41, 98, 255, 0.12)', // fill under line when growing
    belowLineFillColorFalling: 'rgba(41, 98, 255, 0.12)', // fill under line when falling
    belowLineFillColorGrowingBottom: 'rgba(41, 98, 255, 0)',
    belowLineFillColorFallingBottom: 'rgba(41, 98, 255, 0)',
    symbolActiveColor: 'rgba(15, 237, 190, 0.05)', // highlight color for active symbol
    tabs: [
        {
            title: 'Financial',
            symbols: [
                { s: 'NYSE:JPM', d: 'JPMorgan Chase' },
                { s: 'NYSE:WFC', d: 'Wells Fargo Co New' },
                { s: 'NYSE:BAC', d: 'Bank Amer Corp' },
                { s: 'NYSE:HSBC', d: 'Hsbc Hldgs Plc' },
                { s: 'NYSE:C', d: 'Citigroup Inc' },
                { s: 'NYSE:MA', d: 'Mastercard Incorporated' },
            ],
        },
        {
            title: 'Technology',
            symbols: [
                { s: 'NASDAQ:AAPL', d: 'Apple' },
                { s: 'NASDAQ:GOOGL', d: 'Alphabet' },
                { s: 'NASDAQ:MSFT', d: 'Microsoft' },
                { s: 'NASDAQ:META', d: 'Meta Platforms' },
                { s: 'NYSE:ORCL', d: 'Oracle Corp' },
                { s: 'NASDAQ:INTC', d: 'Intel Corp' },
            ],
        },
        {
            title: 'Services',
            symbols: [
                { s: 'NASDAQ:AMZN', d: 'Amazon' },
                { s: 'NYSE:BABA', d: 'Alibaba Group Hldg Ltd' },
                { s: 'NYSE:T', d: 'At&t Inc' },
                { s: 'NYSE:WMT', d: 'Walmart' },
                { s: 'NYSE:V', d: 'Visa' },
            ],
        },
    ],
    support_host: 'https://www.tradingview.com', // TradingView host
    backgroundColor: '#141414', // background color
    width: '100%', // full width
    height: 600, // height in px
    showSymbolLogo: true, // show logo next to symbols
    showChart: true, // display mini chart
};

export const HEATMAP_WIDGET_CONFIG = {
    dataSource: 'SPX500',
    blockSize: 'market_cap_basic',
    blockColor: 'change',
    grouping: 'sector',
    isTransparent: true,
    locale: 'en',
    symbolUrl: '',
    colorTheme: 'dark',
    exchanges: [],
    hasTopBar: false,
    isDataSetEnabled: false,
    isZoomEnabled: true,
    hasSymbolTooltip: true,
    isMonoSize: false,
    width: '100%',
    height: '600',
};

export const TOP_STORIES_WIDGET_CONFIG = {
    displayMode: 'regular',
    feedMode: 'market',
    colorTheme: 'dark',
    isTransparent: false,
    backgroundColor: '#141414',
    locale: 'en',
    market: 'stock',
    width: '100%',
    height: '600',
};

export const MARKET_DATA_WIDGET_CONFIG = {
    title: 'Stocks',
    width: '100%',
    height: 600,
    locale: 'en',
    showSymbolLogo: true,
    colorTheme: 'dark',
    isTransparent: false,
    backgroundColor: '#0F0F0F',
    symbolsGroups: [
        {
            name: 'Financial',
            symbols: [
                { name: 'NYSE:JPM', displayName: 'JPMorgan Chase' },
                { name: 'NYSE:WFC', displayName: 'Wells Fargo Co New' },
                { name: 'NYSE:BAC', displayName: 'Bank Amer Corp' },
                { name: 'NYSE:HSBC', displayName: 'Hsbc Hldgs Plc' },
                { name: 'NYSE:C', displayName: 'Citigroup Inc' },
                { name: 'NYSE:MA', displayName: 'Mastercard Incorporated' },
            ],
        },
        {
            name: 'Technology',
            symbols: [
                { name: 'NASDAQ:AAPL', displayName: 'Apple' },
                { name: 'NASDAQ:GOOGL', displayName: 'Alphabet' },
                { name: 'NASDAQ:MSFT', displayName: 'Microsoft' },
                { name: 'NASDAQ:FB', displayName: 'Meta Platforms' },
                { name: 'NYSE:ORCL', displayName: 'Oracle Corp' },
                { name: 'NASDAQ:INTC', displayName: 'Intel Corp' },
            ],
        },
        {
            name: 'Services',
            symbols: [
                { name: 'NASDAQ:AMZN', displayName: 'Amazon' },
                { name: 'NYSE:BABA', displayName: 'Alibaba Group Hldg Ltd' },
                { name: 'NYSE:T', displayName: 'At&t Inc' },
                { name: 'NYSE:WMT', displayName: 'Walmart' },
                { name: 'NYSE:V', displayName: 'Visa' },
            ],
        },
    ],
};

export const SYMBOL_INFO_WIDGET_CONFIG = (symbol: string) => ({
    symbol: symbol.toUpperCase(),
    colorTheme: 'dark',
    isTransparent: false,
    backgroundColor: '#141414',
    locale: 'en',
    width: '100%',
    height: 170,
});

export const CANDLE_CHART_WIDGET_CONFIG = (symbol: string) => ({
    allow_symbol_change: false,
    calendar: false,
    details: true,
    hide_side_toolbar: true,
    hide_top_toolbar: false,
    hide_legend: false,
    hide_volume: false,
    hotlist: false,
    interval: 'D',
    locale: 'en',
    save_image: false,
    style: 1,
    symbol: symbol.toUpperCase(),
    theme: 'dark',
    timezone: 'exchange',
    backgroundColor: '#141414',
    gridColor: '#141414',
    watchlist: [],
    withdateranges: false,
    compareSymbols: [],
    // RSI and MACD are shown by default so momentum and overbought/oversold conditions are
    // visible without the user adding studies manually.
    studies: ['RSI@tv-basicstudies', 'MACD@tv-basicstudies'],
    width: '100%',
    height: 600,
});

export const BASELINE_WIDGET_CONFIG = (symbol: string) => ({
    allow_symbol_change: false,
    calendar: false,
    details: false,
    hide_side_toolbar: true,
    hide_top_toolbar: false,
    hide_legend: false,
    hide_volume: false,
    hotlist: false,
    interval: 'D',
    locale: 'en',
    save_image: false,
    style: 10,
    symbol: symbol.toUpperCase(),
    theme: 'dark',
    timezone: 'exchange',
    backgroundColor: '#141414',
    gridColor: '#141414',
    watchlist: [],
    withdateranges: false,
    compareSymbols: [],
    studies: [],
    width: '100%',
    height: 600,
});

export const TECHNICAL_ANALYSIS_WIDGET_CONFIG = (symbol: string) => ({
    symbol: symbol.toUpperCase(),
    colorTheme: 'dark',
    isTransparent: false,
    backgroundColor: '#141414',
    locale: 'en',
    width: '100%',
    height: 560,
    interval: '1h',
    // `regular` is the full summary — Oscillators, Summary and Moving Averages side by side.
    // The default collapses to a single gauge, which throws away the most useful signal the
    // widget carries: where the three disagree.
    displayMode: 'regular',
    // The timeframe strip (1m … 1M). A 1h read and a 1d read are different questions, and
    // nobody is going to re-embed the widget to ask the other one.
    showIntervalTabs: true,
    largeChartUrl: '',
});

export const COMPANY_PROFILE_WIDGET_CONFIG = (symbol: string) => ({
    symbol: symbol.toUpperCase(),
    colorTheme: 'dark',
    isTransparent: false,
    backgroundColor: '#141414',
    locale: 'en',
    width: '100%',
    height: 440,
});

export const COMPANY_FINANCIALS_WIDGET_CONFIG = (symbol: string) => ({
    symbol: symbol.toUpperCase(),
    colorTheme: 'dark',
    isTransparent: false,
    backgroundColor: '#141414',
    locale: 'en',
    width: '100%',
    height: 464,
    displayMode: 'regular',
    largeChartUrl: '',
});

// -- Crypto (TradingView widgets + CoinGecko ids) --

export const CRYPTO_MARKET_OVERVIEW_WIDGET_CONFIG = {
    colorTheme: 'dark',
    dateRange: '12M',
    locale: 'en',
    largeChartUrl: '',
    isTransparent: false,
    showFloatingTooltip: true,
    plotLineColorGrowing: '#0FEDBE',
    plotLineColorFalling: '#0FEDBE',
    gridLineColor: 'rgba(240, 243, 250, 0)',
    scaleFontColor: '#DBDBDB',
    belowLineFillColorGrowing: 'rgba(41, 98, 255, 0.12)',
    belowLineFillColorFalling: 'rgba(41, 98, 255, 0.12)',
    belowLineFillColorGrowingBottom: 'rgba(41, 98, 255, 0)',
    belowLineFillColorFallingBottom: 'rgba(41, 98, 255, 0)',
    symbolActiveColor: 'rgba(15, 237, 190, 0.05)',
    tabs: [
        {
            title: 'Layer 1',
            symbols: [
                { s: 'BINANCE:BTCUSDT', d: 'Bitcoin' },
                { s: 'BINANCE:ETHUSDT', d: 'Ethereum' },
                { s: 'BINANCE:SOLUSDT', d: 'Solana' },
                { s: 'BINANCE:BNBUSDT', d: 'BNB' },
                { s: 'BINANCE:ADAUSDT', d: 'Cardano' },
                { s: 'BINANCE:AVAXUSDT', d: 'Avalanche' },
            ],
        },
        {
            title: 'Layer 2 & DeFi',
            symbols: [
                { s: 'BINANCE:LINKUSDT', d: 'Chainlink' },
                { s: 'BINANCE:UNIUSDT', d: 'Uniswap' },
                { s: 'BINANCE:AAVEUSDT', d: 'Aave' },
                { s: 'BINANCE:MATICUSDT', d: 'Polygon' },
                { s: 'BINANCE:ATOMUSDT', d: 'Cosmos' },
                { s: 'BINANCE:DOTUSDT', d: 'Polkadot' },
            ],
        },
        {
            title: 'Meme & Payments',
            symbols: [
                { s: 'BINANCE:DOGEUSDT', d: 'Dogecoin' },
                { s: 'BINANCE:SHIBUSDT', d: 'Shiba Inu' },
                { s: 'BINANCE:XRPUSDT', d: 'XRP' },
                { s: 'BINANCE:LTCUSDT', d: 'Litecoin' },
                { s: 'BINANCE:TRXUSDT', d: 'TRON' },
                { s: 'BINANCE:XLMUSDT', d: 'Stellar' },
            ],
        },
    ],
    support_host: 'https://www.tradingview.com',
    backgroundColor: '#141414',
    width: '100%',
    height: 600,
    showSymbolLogo: true,
    showChart: true,
};

export const CRYPTO_HEATMAP_WIDGET_CONFIG = {
    dataSource: 'Crypto',
    blockSize: 'market_cap_calc',
    blockColor: 'change',
    grouping: 'no_group',
    isTransparent: true,
    locale: 'en',
    symbolUrl: '',
    colorTheme: 'dark',
    exchanges: [],
    hasTopBar: false,
    isDataSetEnabled: false,
    isZoomEnabled: true,
    hasSymbolTooltip: true,
    isMonoSize: false,
    width: '100%',
    height: '600',
};

export const CRYPTO_TOP_STORIES_WIDGET_CONFIG = {
    displayMode: 'regular',
    feedMode: 'market',
    colorTheme: 'dark',
    isTransparent: false,
    backgroundColor: '#141414',
    locale: 'en',
    market: 'crypto',
    width: '100%',
    height: '600',
};

export const CRYPTO_MARKET_DATA_WIDGET_CONFIG = {
    title: 'Crypto',
    width: '100%',
    height: 600,
    locale: 'en',
    showSymbolLogo: true,
    colorTheme: 'dark',
    isTransparent: false,
    backgroundColor: '#0F0F0F',
    symbolsGroups: [
        {
            name: 'Layer 1',
            symbols: [
                { name: 'BINANCE:BTCUSDT', displayName: 'Bitcoin' },
                { name: 'BINANCE:ETHUSDT', displayName: 'Ethereum' },
                { name: 'BINANCE:SOLUSDT', displayName: 'Solana' },
                { name: 'BINANCE:BNBUSDT', displayName: 'BNB' },
                { name: 'BINANCE:ADAUSDT', displayName: 'Cardano' },
                { name: 'BINANCE:AVAXUSDT', displayName: 'Avalanche' },
            ],
        },
        {
            name: 'DeFi',
            symbols: [
                { name: 'BINANCE:LINKUSDT', displayName: 'Chainlink' },
                { name: 'BINANCE:UNIUSDT', displayName: 'Uniswap' },
                { name: 'BINANCE:AAVEUSDT', displayName: 'Aave' },
                { name: 'BINANCE:ATOMUSDT', displayName: 'Cosmos' },
                { name: 'BINANCE:DOTUSDT', displayName: 'Polkadot' },
            ],
        },
        {
            name: 'Meme & Payments',
            symbols: [
                { name: 'BINANCE:DOGEUSDT', displayName: 'Dogecoin' },
                { name: 'BINANCE:SHIBUSDT', displayName: 'Shiba Inu' },
                { name: 'BINANCE:XRPUSDT', displayName: 'XRP' },
                { name: 'BINANCE:LTCUSDT', displayName: 'Litecoin' },
                { name: 'BINANCE:TRXUSDT', displayName: 'TRON' },
            ],
        },
    ],
};

// CoinGecko ids, ordered by market cap. Used for widget symbol lists; the crypto
// dashboard itself always reads live rankings from the API.
export const POPULAR_CRYPTO_IDS = [
    'bitcoin',
    'ethereum',
    'tether',
    'ripple',
    'binancecoin',
    'solana',
    'usd-coin',
    'dogecoin',
    'cardano',
    'tron',
    'avalanche-2',
    'shiba-inu',
    'polkadot',
    'chainlink',
    'toncoin',
    'sui',
    'stellar',
    'hedera-hashgraph',
    'litecoin',
    'bitcoin-cash',
    'uniswap',
    'near',
    'aptos',
    'internet-computer',
    'ethereum-classic',
    'monero',
    'filecoin',
    'cosmos',
    'arbitrum',
    'optimism',
    'injective-protocol',
    'render-token',
    'cronos',
    'algorand',
    'the-graph',
    'vechain',
    'maker',
    'aave',
    'theta-token',
    'axie-infinity',
    'decentraland',
    'the-sandbox',
    'eos',
    'tezos',
    'flow',
    'fantom',
    'curve-dao-token',
    'compound-governance-token',
    'pancakeswap-token',
    'dogwifcoin',
];

/**
 * The stock universe the screener scans, roughly in order of liquidity.
 *
 * A curated list rather than an index feed, deliberately: a screener's scores are only comparable
 * within a run over a stable universe, and an index source changes composition without telling you.
 * It is also kept longer than the default setting so that raising `SCREENER_UNIVERSE_SIZE` actually
 * raises the scan — the list was 50, which silently capped the setting at 50 whenever it was set
 * higher.
 *
 * The first fifty lean heavily tech and growth; the block below adds cross-sector large caps so a
 * full scan reads as the market rather than as one corner of it.
 */
export const POPULAR_STOCK_SYMBOLS = [
    // Tech Giants (the big technology companies)
    'AAPL',
    'MSFT',
    'GOOGL',
    'AMZN',
    'TSLA',
    'META',
    'NVDA',
    'NFLX',
    'ORCL',
    'CRM',

    // Growing Tech Companies
    'ADBE',
    'INTC',
    'AMD',
    'PYPL',
    'UBER',
    'ZOOM',
    'SPOT',
    'SQ',
    'SHOP',
    'ROKU',

    // Newer Tech Companies
    'SNOW',
    'PLTR',
    'COIN',
    'RBLX',
    'DDOG',
    'CRWD',
    'NET',
    'OKTA',
    'TWLO',
    'ZM',

    // Consumer & Delivery Apps
    'DOCU',
    'PTON',
    'PINS',
    'SNAP',
    'LYFT',
    'DASH',
    'ABNB',
    'RIVN',
    'LCID',
    'NIO',

    // International Companies
    'XPEV',
    'LI',
    'BABA',
    'JD',
    'PDD',
    'TME',
    'BILI',
    'DIDI',
    'GRAB',
    'SE',

    // Financials
    'JPM',
    'BAC',
    'WFC',
    'GS',
    'MS',
    'C',
    'V',
    'MA',
    'AXP',
    'BLK',
    'SCHW',
    'SPGI',
    'CB',
    'PGR',
    'USB',

    // Healthcare
    'JNJ',
    'UNH',
    'LLY',
    'PFE',
    'MRK',
    'ABBV',
    'TMO',
    'ABT',
    'DHR',
    'BMY',
    'AMGN',
    'GILD',
    'ISRG',

    // Consumer Staples & Retail
    'WMT',
    'COST',
    'HD',
    'MCD',
    'NKE',
    'SBUX',
    'TGT',
    'LOW',
    'KO',
    'PEP',
    'PG',
    'PM',
    'MO',

    // Industrials
    'BA',
    'CAT',
    'GE',
    'HON',
    'UPS',
    'RTX',
    'LMT',
    'DE',
    'MMM',
    'UNP',

    // Energy
    'XOM',
    'CVX',
    'COP',
    'SLB',

    // Media & Telecom
    'DIS',
    'CMCSA',
    'T',
    'VZ',
    'TMUS',

    // Semiconductors, Materials & Utilities
    'AVGO',
    'QCOM',
    'TXN',
    'LIN',
    'NEE',
];

export const NO_MARKET_NEWS =
    '<p class="mobile-text" style="margin:0 0 20px 0;font-size:16px;line-height:1.6;color:#4b5563;">No market news available today. Please check back tomorrow.</p>';

export const WATCHLIST_TABLE_HEADER = [
    'Company',
    'Symbol',
    'Price',
    'Change',
    'Market Cap',
    'P/E Ratio',
    'Alert',
    'Action',
];

export const PASSWORD_RULES = [
    { label: 'At least 8 characters', test: (pw: string) => pw.length >= 8 },
    { label: 'At least 1 uppercase letter', test: (pw: string) => /[A-Z]/.test(pw) },
    { label: 'At least 1 lowercase letter', test: (pw: string) => /[a-z]/.test(pw) },
    { label: 'At least 1 number', test: (pw: string) => /[0-9]/.test(pw) },
] as const;

export const PASSWORD_VALIDATION = {
    required: 'Password is required',
    minLength: { value: 8, message: 'Password must be at least 8 characters' },
    pattern: {
        value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
        message: 'Password must include uppercase, lowercase, and a number',
    },
};

// ── Philippine Stock Exchange ───────────────────────────────────────────
//
// TradingView namespaces non-US symbols by exchange, so every PSE symbol carries a `PSE:` prefix.
// `PSE:PSEI` is the index itself, confirmed against TradingView's own symbol search rather than
// inferred from the ticker — the app's other data sources cannot supply PSE at all, so if these
// configs are wrong there is no backend result to fall back on and the panel would simply be empty.

/** The PSEi composite, as a chart. */
export const PH_INDEX_WIDGET_CONFIG = {
    autosize: true,
    symbol: 'PSE:PSEI',
    interval: 'D',
    timezone: 'Asia/Manila',
    theme: 'dark',
    style: '1',
    locale: 'en',
    // Same explicit background as every other embed: `theme` is set, but transparency is what
    // previously produced a light surface, and there is no parent colour to rely on here.
    backgroundColor: '#141414',
    gridColor: 'rgba(240, 243, 250, 0)',
    hide_side_toolbar: true,
    allow_symbol_change: true,
    details: false,
    hotlist: false,
    calendar: false,
    studies: [],
    watchlist: [],
    show_popup_button: true,
    popup_width: '1000',
    popup_height: '650',
    support_host: 'https://www.tradingview.com',
};

/**
 * A PSE quote board, built from the live feed rather than a hardcoded list, so it shows what
 * actually trades instead of what looked liquid when this file was written.
 */
export const phQuotesWidgetConfig = (symbols: { symbol: string; name: string }[]) => ({
    isTransparent: false,
    backgroundColor: '#0F0F0F',
    width: '100%',
    height: '100%',
    locale: 'en',
    colorTheme: 'dark',
    symbolsGroups: [
        {
            name: 'Philippine Stock Exchange',
            symbols: symbols.map((entry) => ({
                name: `PSE:${entry.symbol}`,
                displayName: entry.symbol,
            })),
        },
    ],
});
