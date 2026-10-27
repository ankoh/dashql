import type { Tick } from './tick_feed.js';
import { parseFeedNumber, WebSocketTickFeed, type FeedMessage, type FeedProtocol, type WebSocketFeedOptions } from './websocket_feed.js';

/// The public market data streams of Binance, the host only serves market data and needs no credentials
export const BINANCE_FEED_URL = 'wss://data-stream.binance.vision/stream';

/// The pairs of the board, as Binance names their streams
export const BINANCE_PAIRS: readonly string[] = [
    'btcusdt', 'ethusdt', 'bnbusdt', 'solusdt', 'xrpusdt', 'dogeusdt', 'adausdt', 'trxusdt', 'avaxusdt', 'linkusdt',
    'dotusdt', 'ltcusdt', 'bchusdt', 'shibusdt', 'nearusdt', 'aptusdt', 'uniusdt', 'atomusdt', 'xlmusdt', 'etcusdt',
];

/// The quote currencies of the pairs, the longest first so that USDT is not read as USD
const QUOTES = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'EUR', 'USD'];

/// The symbol of a pair on the board, e.g. BTCUSDT as BTC-USDT like the pairs of Coinbase
export function binanceSymbol(pair: string): string {
    const upper = pair.toUpperCase();
    const quote = QUOTES.find(q => upper.endsWith(q) && upper.length > q.length);
    return quote == null ? upper : `${upper.slice(0, -quote.length)}-${quote}`;
}

/// The url of the combined stream of the trades and the best quotes of pairs
export function binanceStreamUrl(url: string, pairs: readonly string[]): string {
    return `${url}?streams=${pairs.flatMap(p => [`${p}@trade`, `${p}@bookTicker`]).join('/')}`;
}

/// The best bid and ask of a pair
interface Quote {
    bid: number | null;
    ask: number | null;
}

/// Reads the combined stream of trades and best quotes.
/// A trade carries no quote, it gets the latest best bid and ask of its pair.
export class BinanceProtocol implements FeedProtocol {
    /// The latest quote per pair
    private readonly quotes = new Map<string, Quote>();

    constructor(readonly url: string) { }

    subscription(): string | null {
        return null;
    }

    read(data: string): FeedMessage {
        let message: any;
        try {
            message = JSON.parse(data);
        } catch {
            return null;
        }
        if (message?.error != null) {
            return { error: typeof message.error.msg === 'string' ? message.error.msg : 'error' };
        }
        const payload = message?.data;
        if (typeof message?.stream !== 'string' || payload == null || typeof payload.s !== 'string') return null;
        if (message.stream.endsWith('@bookTicker')) {
            this.quotes.set(payload.s, { bid: parseFeedNumber(payload.b), ask: parseFeedNumber(payload.a) });
            return null;
        }
        if (payload.e !== 'trade') return null;
        const price = parseFeedNumber(payload.p);
        const ts = parseFeedNumber(payload.T);
        if (price == null || ts == null) return null;
        const quote = this.quotes.get(payload.s);
        const tick: Tick = {
            symbol: binanceSymbol(payload.s),
            ts,
            price,
            size: parseFeedNumber(payload.q) ?? 0,
            bid: quote?.bid ?? null,
            ask: quote?.ask ?? null,
        };
        return { tick };
    }
}

/// The options of the Binance feed
export interface BinanceFeedOptions extends WebSocketFeedOptions {
    /// The url of the combined streams
    url?: string;
    /// The pairs to subscribe to, as Binance names their streams
    pairs?: readonly string[];
}

/// The trades of crypto pairs on Binance, from its public trade and book ticker streams
export class BinanceFeed extends WebSocketTickFeed {
    constructor(options: BinanceFeedOptions = {}) {
        super(new BinanceProtocol(binanceStreamUrl(options.url ?? BINANCE_FEED_URL, options.pairs ?? BINANCE_PAIRS)), options);
    }
}
