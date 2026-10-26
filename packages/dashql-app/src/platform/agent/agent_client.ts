import type { LoggerLike } from '../logger/logger.js';
import {
    AGENT_PROTOCOL_VERSION,
    type AgentClientSession,
    type AgentCommandParams,
    type AgentCommandResult,
    type AgentErrorCode,
    type AgentRpcError,
    type AgentRpcMessage,
    type ClientSessionsParams,
} from './agent_protocol.js';

const LOG_CTX = 'agent_client';

/// The connection to the local agent server
export enum AgentConnectionStatus {
    /// No session has agent access and nothing holds the connection, the client does not connect
    Off = 'off',
    /// Connecting, or waiting to reconnect
    Connecting = 'connecting',
    /// Connected
    Connected = 'connected',
}

/// The part of the WebSocket API that the client uses
export interface AgentSocket {
    readonly readyState: number;
    onopen: ((event: unknown) => void) | null;
    onclose: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    send(data: string): void;
    close(code?: number, reason?: string): void;
}

const SOCKET_OPEN = 1;

/// An error that a command reports to the agent
export class AgentCommandError extends Error {
    constructor(readonly code: AgentErrorCode, message: string) {
        super(message);
    }
}

export interface AgentClientOptions {
    /// The WebSocket endpoint, e.g. ws://127.0.0.1:47100/v1/ws
    url: string;
    /// The kind of client, "web" or "desktop"
    clientKind: string;
    logger: LoggerLike;
    /// Run a command of the command line tool
    handleCommand: (params: AgentCommandParams) => Promise<AgentCommandResult>;
    /// Receive a notification, e.g. agent/status
    onNotification: (method: string, params: unknown) => void;
    /// Follow the connection status
    onStatus: (status: AgentConnectionStatus) => void;
    /// Create a socket, replaceable in tests
    createSocket?: (url: string) => AgentSocket;
    /// The first reconnect delay, doubled after every failure
    initialBackoffMs?: number;
    /// The longest reconnect delay
    maxBackoffMs?: number;
}

interface PendingRequest {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
}

/// The WebSocket client of the agent bridge.
///
/// Connects while at least one session has agent access and reconnects with backoff.
/// The server queues calls while the page is gone, so a reload loses nothing.
export class AgentClient {
    readonly #options: AgentClientOptions;
    #socket: AgentSocket | null = null;
    #sessions: AgentClientSession[] = [];
    #focused: string | null = null;
    /// Stay connected without sessions, e.g. while the settings show the agent server
    #held = false;
    #status = AgentConnectionStatus.Off;
    #backoffMs: number;
    #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    #nextRequestId = 1;
    #pending = new Map<number, PendingRequest>();

    constructor(options: AgentClientOptions) {
        this.#options = options;
        this.#backoffMs = options.initialBackoffMs ?? 1000;
    }

    get status(): AgentConnectionStatus {
        return this.#status;
    }

    /// Announce the sessions with agent access, connects or disconnects as needed
    setSessions(sessions: AgentClientSession[], focused: string | null): void {
        this.#sessions = sessions;
        this.#focused = focused != null && sessions.some(s => s.id === focused) ? focused : null;
        this.#update();
    }

    /// Stay connected while no session has agent access
    setHeld(held: boolean): void {
        this.#held = held;
        this.#update();
    }

    #wanted(): boolean {
        return this.#sessions.length > 0 || this.#held;
    }

    #update(): void {
        if (!this.#wanted()) {
            this.#disconnect();
            return;
        }
        if (this.#socket == null && this.#reconnectTimer == null) {
            this.#connect();
        } else {
            this.#announce();
        }
    }

    /// Send a request to the server
    request<T>(method: string, params: unknown): Promise<T> {
        const socket = this.#socket;
        if (socket == null || socket.readyState !== SOCKET_OPEN) {
            return Promise.reject(new Error('The agent server is not connected'));
        }
        const id = this.#nextRequestId++;
        return new Promise<T>((resolve, reject) => {
            this.#pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
            socket.send(JSON.stringify({ id, method, params } satisfies AgentRpcMessage));
        });
    }

    /// Disconnect for good
    dispose(): void {
        this.#sessions = [];
        this.#held = false;
        this.#disconnect();
    }

    #setStatus(status: AgentConnectionStatus): void {
        if (this.#status === status) return;
        this.#status = status;
        this.#options.onStatus(status);
    }

    #announce(): void {
        const socket = this.#socket;
        if (socket == null || socket.readyState !== SOCKET_OPEN) return;
        const params: ClientSessionsParams = {
            protocol: AGENT_PROTOCOL_VERSION,
            client: this.#options.clientKind,
            sessions: this.#sessions,
            focused: this.#focused,
        };
        socket.send(JSON.stringify({ method: 'client/sessions', params } satisfies AgentRpcMessage));
    }

    #connect(): void {
        this.#reconnectTimer = null;
        this.#setStatus(AgentConnectionStatus.Connecting);
        let socket: AgentSocket;
        try {
            socket = (this.#options.createSocket ?? (url => new WebSocket(url) as unknown as AgentSocket))(this.#options.url);
        } catch (e: unknown) {
            this.#options.logger.warn('Cannot connect to the agent server', { url: this.#options.url, error: String(e) }, LOG_CTX);
            this.#scheduleReconnect();
            return;
        }
        this.#socket = socket;
        socket.onopen = () => {
            this.#options.logger.info('Connected to the agent server', { url: this.#options.url }, LOG_CTX);
            this.#backoffMs = this.#options.initialBackoffMs ?? 1000;
            this.#setStatus(AgentConnectionStatus.Connected);
            this.#announce();
        };
        socket.onmessage = event => {
            if (typeof event.data === 'string') this.#receive(socket, event.data);
        };
        socket.onerror = () => { };
        socket.onclose = () => {
            if (this.#socket !== socket) return;
            this.#socket = null;
            this.#rejectPending('The agent server disconnected');
            if (this.#wanted()) {
                this.#scheduleReconnect();
            } else {
                this.#setStatus(AgentConnectionStatus.Off);
            }
        };
    }

    #scheduleReconnect(): void {
        this.#setStatus(AgentConnectionStatus.Connecting);
        const delay = this.#backoffMs;
        this.#backoffMs = Math.min(this.#backoffMs * 2, this.#options.maxBackoffMs ?? 30_000);
        this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
    }

    #disconnect(): void {
        if (this.#reconnectTimer != null) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
        const socket = this.#socket;
        this.#socket = null;
        if (socket != null) {
            socket.onclose = null;
            socket.close(1000, 'agent access turned off');
            this.#options.logger.info('Disconnected from the agent server', {}, LOG_CTX);
        }
        this.#rejectPending('Agent access was turned off');
        this.#setStatus(AgentConnectionStatus.Off);
    }

    #rejectPending(message: string): void {
        for (const pending of this.#pending.values()) pending.reject(new Error(message));
        this.#pending.clear();
    }

    #receive(socket: AgentSocket, text: string): void {
        let message: AgentRpcMessage;
        try {
            message = JSON.parse(text) as AgentRpcMessage;
        } catch {
            this.#options.logger.warn('Received invalid JSON from the agent server', {}, LOG_CTX);
            return;
        }
        if (message.method == null) {
            const pending = this.#pending.get(Number(message.id));
            if (pending == null) return;
            this.#pending.delete(Number(message.id));
            if (message.error != null) {
                pending.reject(new Error(message.error.message));
            } else {
                pending.resolve(message.result);
            }
            return;
        }
        if (message.id == null) {
            this.#options.onNotification(message.method, message.params);
            return;
        }
        const id = message.id;
        const reply = (body: { result: AgentCommandResult } | { error: AgentRpcError }) => {
            if (socket.readyState === SOCKET_OPEN) socket.send(JSON.stringify({ id, ...body }));
        };
        if (message.method !== 'command') {
            reply({ error: { code: 'usage', message: `unknown method: ${message.method}` } });
            return;
        }
        const params = message.params as AgentCommandParams;
        this.#options.handleCommand(params).then(
            result => reply({ result }),
            (e: unknown) => {
                const code = e instanceof AgentCommandError ? e.code : 'failed';
                reply({ error: { code, message: e instanceof Error ? e.message : String(e) } });
            },
        );
    }
}
