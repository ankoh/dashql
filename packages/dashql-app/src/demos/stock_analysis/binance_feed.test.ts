import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BinanceFeed, BinanceProtocol, binanceStreamUrl, binanceSymbol } from './binance_feed.js';
import type { Tick } from './tick_feed.js';

/// A trade as the combined stream sends it
const TRADE = {
    stream: 'btcusdt@trade',
    data: { e: 'trade', E: 1793107450256, s: 'BTCUSDT', t: 6795124495, p: '80246.42000000', q: '0.00026000', T: 1793107450255, m: true, M: true },
};
/// A best quote as the combined stream sends it
const BOOK = {
    stream: 'btcusdt@bookTicker',
    data: { u: 400900217, s: 'BTCUSDT', b: '80246.41000000', B: '1.2', a: '80246.42000000', A: '0.5' },
};

class FakeSocket {
    sent: string[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(readonly url: string) { }
    send(data: string) { this.sent.push(data); }
    close() { this.closed = true; }
    open() { this.onopen?.(); }
    receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

describe('Binance', () => {
    it('names the pairs like Coinbase', () => {
        expect(binanceSymbol('BTCUSDT')).toBe('BTC-USDT');
        expect(binanceSymbol('ethbtc')).toBe('ETH-BTC');
        expect(binanceSymbol('USDCUSDT')).toBe('USDC-USDT');
    });

    it('subscribes to the trades and the best quotes in the url', () => {
        expect(binanceStreamUrl('wss://host/stream', ['btcusdt', 'ethusdt'])).toBe(
            'wss://host/stream?streams=btcusdt@trade/btcusdt@bookTicker/ethusdt@trade/ethusdt@bookTicker',
        );
    });

    it('gives a trade the latest quote of its pair', () => {
        const protocol = new BinanceProtocol('wss://host/stream');
        expect(protocol.read(JSON.stringify(TRADE))).toEqual({
            tick: { symbol: 'BTC-USDT', ts: 1793107450255, price: 80246.42, size: 0.00026, bid: null, ask: null },
        });
        expect(protocol.read(JSON.stringify(BOOK))).toBeNull();
        expect(protocol.read(JSON.stringify(TRADE))).toMatchObject({ tick: { bid: 80246.41, ask: 80246.42 } });
    });

    it('reads errors and ignores everything else', () => {
        const protocol = new BinanceProtocol('wss://host/stream');
        expect(protocol.read(JSON.stringify({ error: { code: 2, msg: 'Invalid request' }, id: 1 }))).toEqual({ error: 'Invalid request' });
        expect(protocol.read(JSON.stringify({ result: null, id: 1 }))).toBeNull();
        expect(protocol.read(JSON.stringify({ ...TRADE, data: { ...TRADE.data, p: 'n/a' } }))).toBeNull();
        expect(protocol.read('not json')).toBeNull();
    });
});

describe('BinanceFeed', () => {
    let sockets: FakeSocket[];
    let delivered: Tick[][];
    let feed: BinanceFeed;

    beforeEach(() => {
        vi.useFakeTimers();
        sockets = [];
        delivered = [];
        feed = new BinanceFeed({
            pairs: ['btcusdt'],
            emitIntervalMs: 100,
            createSocket: url => {
                const socket = new FakeSocket(url);
                sockets.push(socket);
                return socket as unknown as WebSocket;
            },
        });
    });
    afterEach(() => {
        feed.stop();
        vi.useRealTimers();
    });

    it('delivers the trades of the streams of its url', async () => {
        feed.start(ticks => delivered.push(ticks), () => { });
        expect(sockets[0].url).toBe('wss://data-stream.binance.vision/stream?streams=btcusdt@trade/btcusdt@bookTicker');
        sockets[0].open();
        expect(sockets[0].sent).toEqual([]);
        sockets[0].receive(BOOK);
        sockets[0].receive(TRADE);
        await vi.advanceTimersByTimeAsync(100);
        expect(delivered).toHaveLength(1);
        expect(delivered[0]).toEqual([{ symbol: 'BTC-USDT', ts: 1793107450255, price: 80246.42, size: 0.00026, bid: 80246.41, ask: 80246.42 }]);
    });
});
