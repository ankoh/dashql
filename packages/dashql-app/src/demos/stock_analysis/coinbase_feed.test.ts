import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoinbaseFeed, parseCoinbaseError, parseCoinbaseMessage } from './coinbase_feed.js';
import type { Tick, TickFeedStatus } from './tick_feed.js';

/// A ticker message as the feed sends it
const TICKER = {
    type: 'ticker',
    sequence: 138403125064,
    product_id: 'BTC-USD',
    price: '80164.18',
    open_24h: '79566.1',
    volume_24h: '5040.10705301',
    best_bid: '80164.18',
    best_ask: '80164.19',
    side: 'sell',
    time: '2026-10-27T13:02:54.749209Z',
    trade_id: 1111197484,
    last_size: '0.0001',
};

class FakeSocket {
    sent: any[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(readonly url: string) { }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.closed = true; }
    open() { this.onopen?.(); }
    drop() { this.onclose?.(); }
    receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

describe('parseCoinbaseMessage', () => {
    it('reads the trade of a ticker message', () => {
        expect(parseCoinbaseMessage(JSON.stringify(TICKER))).toEqual({
            symbol: 'BTC-USD',
            ts: Date.parse('2026-10-27T13:02:54.749Z'),
            price: 80164.18,
            size: 0.0001,
            bid: 80164.18,
            ask: 80164.19,
        });
    });

    it('ignores other messages', () => {
        expect(parseCoinbaseMessage(JSON.stringify({ type: 'subscriptions', channels: [] }))).toBeNull();
        expect(parseCoinbaseMessage(JSON.stringify({ type: 'heartbeat' }))).toBeNull();
        expect(parseCoinbaseMessage(JSON.stringify({ ...TICKER, price: 'n/a' }))).toBeNull();
        expect(parseCoinbaseMessage('not json')).toBeNull();
    });

    it('reads errors', () => {
        expect(parseCoinbaseError(JSON.stringify({ type: 'error', message: 'Failed to subscribe', reason: 'unknown product' }))).toBe('Failed to subscribe: unknown product');
        expect(parseCoinbaseError(JSON.stringify(TICKER))).toBeNull();
    });
});

describe('CoinbaseFeed', () => {
    let sockets: FakeSocket[];
    let delivered: Tick[][];
    let statuses: TickFeedStatus[];
    let feed: CoinbaseFeed;

    beforeEach(() => {
        vi.useFakeTimers();
        sockets = [];
        delivered = [];
        statuses = [];
        feed = new CoinbaseFeed({
            products: ['BTC-USD'],
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

    it('subscribes and delivers the trades in batches', async () => {
        feed.start(ticks => delivered.push(ticks), status => statuses.push(status));
        sockets[0].open();
        expect(sockets[0].sent).toEqual([{ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker'] }]);
        sockets[0].receive({ type: 'subscriptions', channels: [] });
        sockets[0].receive(TICKER);
        sockets[0].receive({ ...TICKER, price: '80165' });
        await vi.advanceTimersByTimeAsync(100);
        expect(delivered).toHaveLength(1);
        expect(delivered[0].map(t => t.price)).toEqual([80164.18, 80165]);
        // Every trade reports the feed as live, the status only changes once
        expect(statuses.map(s => s.state)).toEqual(['connecting', 'live']);
    });

    it('reconnects with an increasing delay', async () => {
        feed.start(ticks => delivered.push(ticks), status => statuses.push(status));
        sockets[0].drop();
        await vi.advanceTimersByTimeAsync(999);
        expect(sockets).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(sockets).toHaveLength(2);
        sockets[1].drop();
        await vi.advanceTimersByTimeAsync(1999);
        expect(sockets).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(sockets).toHaveLength(3);
    });

    it('closes the socket on stop and does not reconnect', async () => {
        feed.start(ticks => delivered.push(ticks), status => statuses.push(status));
        feed.stop();
        expect(sockets[0].closed).toBe(true);
        sockets[0].drop();
        await vi.advanceTimersByTimeAsync(60000);
        expect(sockets).toHaveLength(1);
    });
});
