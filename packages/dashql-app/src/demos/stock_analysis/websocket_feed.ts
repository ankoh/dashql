import type { Tick, TickFeed, TickFeedStatus } from './tick_feed.js';

/// The longest wait before a reconnect
const MAX_RECONNECT_DELAY_MS = 30 * 1000;

/// What a message of a market data stream holds for the feed
export type FeedMessage =
    /// A trade
    | { tick: Tick }
    /// An error that the stream reports
    | { error: string }
    /// Anything else, e.g. the confirmation of a subscription or a quote that the next trade carries
    | null;

/// The protocol of a market data stream
export interface FeedProtocol {
    /// The url of the stream
    url: string;
    /// The message to send once the socket is open, e.g. a subscription, null if the url subscribes
    subscription(): string | null;
    /// Read a text message of the stream
    read(data: string): FeedMessage;
}

/// The options of a WebSocket feed
export interface WebSocketFeedOptions {
    /// The time between two deliveries
    emitIntervalMs?: number;
    /// Create the socket, for tests
    createSocket?: (url: string) => WebSocket;
}

/// The trades of a market data stream over a WebSocket, delivered in batches.
/// The feed reconnects with an increasing delay when the socket closes.
export class WebSocketTickFeed implements TickFeed {
    /// The socket
    private socket: WebSocket | null = null;
    /// The ticks since the last delivery
    private pending: Tick[] = [];
    /// The timer of the deliveries
    private emitTimer: ReturnType<typeof setInterval> | null = null;
    /// The timer of the next reconnect
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    /// The delay of the next reconnect
    private reconnectDelayMs = 1000;
    /// Is the feed stopped?
    private stopped = true;

    private readonly emitIntervalMs: number;
    private readonly createSocket: (url: string) => WebSocket;

    constructor(private readonly protocol: FeedProtocol, options: WebSocketFeedOptions = {}) {
        this.emitIntervalMs = options.emitIntervalMs ?? 100;
        this.createSocket = options.createSocket ?? (url => new WebSocket(url));
    }

    start(emit: (ticks: Tick[]) => void, onStatus: (status: TickFeedStatus) => void): void {
        this.stop();
        this.stopped = false;
        this.emitTimer = setInterval(() => {
            if (this.pending.length === 0) return;
            const ticks = this.pending;
            this.pending = [];
            emit(ticks);
        }, this.emitIntervalMs);
        // Every trade would report the feed as live again, only changes are reported
        let reported: string | null = null;
        this.connect(status => {
            const key = `${status.state}:${status.detail ?? ''}`;
            if (key === reported) return;
            reported = key;
            onStatus(status);
        });
    }

    private connect(onStatus: (status: TickFeedStatus) => void): void {
        onStatus({ state: 'connecting' });
        const socket = this.createSocket(this.protocol.url);
        this.socket = socket;
        socket.onopen = () => {
            const subscription = this.protocol.subscription();
            if (subscription != null) socket.send(subscription);
        };
        socket.onmessage = (event: MessageEvent) => {
            if (typeof event.data !== 'string') return;
            const message = this.protocol.read(event.data);
            if (message == null) return;
            if ('error' in message) {
                onStatus({ state: 'failed', detail: message.error });
                return;
            }
            if (this.pending.length === 0) this.reconnectDelayMs = 1000;
            this.pending.push(message.tick);
            onStatus({ state: 'live' });
        };
        socket.onclose = () => {
            if (this.stopped || this.socket !== socket) return;
            this.socket = null;
            const delay = this.reconnectDelayMs;
            this.reconnectDelayMs = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
            onStatus({ state: 'connecting', detail: `Reconnecting in ${Math.round(delay / 1000)}s` });
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                if (!this.stopped) this.connect(onStatus);
            }, delay);
        };
    }

    stop(): void {
        this.stopped = true;
        if (this.emitTimer != null) clearInterval(this.emitTimer);
        if (this.reconnectTimer != null) clearTimeout(this.reconnectTimer);
        this.emitTimer = null;
        this.reconnectTimer = null;
        const socket = this.socket;
        this.socket = null;
        socket?.close();
        this.pending = [];
    }
}

/// A number of a stream, the streams send numbers as strings
export function parseFeedNumber(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}
