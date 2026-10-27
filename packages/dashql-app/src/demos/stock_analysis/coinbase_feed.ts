import type { Tick } from './tick_feed.js';
import { parseFeedNumber, WebSocketTickFeed, type FeedMessage, type WebSocketFeedOptions } from './websocket_feed.js';

/// The public market data feed of Coinbase Exchange, its ticker channel needs no credentials
export const COINBASE_FEED_URL = 'wss://ws-feed.exchange.coinbase.com';

/// The pairs of the board
export const COINBASE_PRODUCTS: readonly string[] = [
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD', 'AVAX-USD', 'LINK-USD',
    'DOT-USD', 'LTC-USD', 'BCH-USD', 'UNI-USD', 'AAVE-USD', 'ATOM-USD', 'XLM-USD', 'ETC-USD',
    'FIL-USD', 'NEAR-USD', 'APT-USD', 'ARB-USD', 'OP-USD', 'SHIB-USD',
];

/// The trade of a ticker message, null for other messages, e.g. the confirmation of the subscription
export function parseCoinbaseMessage(data: string): Tick | null {
    let message: any;
    try {
        message = JSON.parse(data);
    } catch {
        return null;
    }
    if (message?.type !== 'ticker' || typeof message.product_id !== 'string') return null;
    const price = parseFeedNumber(message.price);
    const ts = typeof message.time === 'string' ? Date.parse(message.time) : NaN;
    if (price == null || !Number.isFinite(ts)) return null;
    return {
        symbol: message.product_id,
        ts,
        price,
        size: parseFeedNumber(message.last_size) ?? 0,
        bid: parseFeedNumber(message.best_bid),
        ask: parseFeedNumber(message.best_ask),
    };
}

/// The error of an error message of the feed, null for other messages
export function parseCoinbaseError(data: string): string | null {
    try {
        const message = JSON.parse(data);
        if (message?.type !== 'error') return null;
        return [message.message, message.reason].filter(m => typeof m === 'string' && m.length > 0).join(': ') || 'error';
    } catch {
        return null;
    }
}

/// The options of the Coinbase feed
export interface CoinbaseFeedOptions extends WebSocketFeedOptions {
    /// The url of the feed
    url?: string;
    /// The pairs to subscribe to
    products?: readonly string[];
}

/// The trades of crypto pairs on Coinbase, from its public ticker channel.
/// A ticker message carries the trade together with the best bid and ask.
export class CoinbaseFeed extends WebSocketTickFeed {
    constructor(options: CoinbaseFeedOptions = {}) {
        const products = options.products ?? COINBASE_PRODUCTS;
        super({
            url: options.url ?? COINBASE_FEED_URL,
            subscription: () => JSON.stringify({ type: 'subscribe', product_ids: products, channels: ['ticker'] }),
            read: (data: string): FeedMessage => {
                const tick = parseCoinbaseMessage(data);
                if (tick != null) return { tick };
                const error = parseCoinbaseError(data);
                return error == null ? null : { error };
            },
        }, options);
    }
}
