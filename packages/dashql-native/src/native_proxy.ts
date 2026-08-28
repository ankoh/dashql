import type {UtilityProcess} from "electron";

export interface NativeProxyRequest {
    body: Uint8Array;
    headers: string[][];
    method: string;
    url: string;
}

export interface NativeProxyResponse {
    body: Uint8Array;
    headers: string[][];
    status: number;
    statusText: string;
}

interface NativeProxyMessage extends Partial<NativeProxyResponse> {
    error?: string;
    id?: number;
    type?: string;
}

interface PendingRequest {
    reject(error: Error): void;
    resolve(response: NativeProxyResponse): void;
    timeout: NodeJS.Timeout;
}

const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const ALLOWED_METHODS = new Set(["DELETE", "GET", "PATCH", "POST"]);
const ALLOWED_ROUTES = /^(?:\/health|\/(grpc|http|docker)\/)/;

export function validateNativeProxyRequest(request: NativeProxyRequest): void {
    if (!ALLOWED_METHODS.has(request.method)) {
        throw new Error("Rejected native proxy method");
    }
    const url = new URL(request.url);
    if (url.protocol !== "dashql-native:" || url.hostname !== "localhost" ||
        url.username || url.password || url.port || !ALLOWED_ROUTES.test(url.pathname)) {
        throw new Error("Rejected native proxy URL");
    }
    if (!(request.body instanceof Uint8Array) || request.body.byteLength > MAX_REQUEST_BYTES) {
        throw new Error(`Native proxy request body must not exceed ${MAX_REQUEST_BYTES} bytes`);
    }
    if (!Array.isArray(request.headers) || request.headers.length > 128 || request.headers.some((header) =>
        !Array.isArray(header) || header.length !== 2 || header.some((value) => typeof value !== "string" || value.length > 8192)
    )) {
        throw new Error("Rejected native proxy headers");
    }
}

export class NativeProxyService {
    private closed = false;
    private nextRequestId = 1;
    private readonly pending = new Map<number, PendingRequest>();
    private readyPromise: Promise<void>;
    private resolveReady!: () => void;
    private rejectReady!: (error: Error) => void;

    constructor(private readonly child: UtilityProcess) {
        this.readyPromise = new Promise<void>((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        child.on("message", (message) => this.onMessage(message));
        child.once("error", (type, location) => this.fail(new Error(`Native proxy failed: ${type} at ${location}`)));
        child.once("exit", (code) => this.fail(new Error(`Native proxy exited with code ${code}`)));
    }

    async ready(): Promise<void> {
        await this.readyPromise;
    }

    async request(request: NativeProxyRequest): Promise<NativeProxyResponse> {
        if (this.closed) {
            throw new Error("Native proxy is closed");
        }
        await this.ready();
        validateNativeProxyRequest(request);

        const id = this.nextRequestId++;
        return await new Promise<NativeProxyResponse>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Native proxy request ${id} timed out`));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(id, {reject, resolve, timeout});
            this.child.postMessage({...request, id});
        });
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.rejectReady(new Error("Native proxy closed before startup"));
        this.rejectPending(new Error("Native proxy closed"));
        this.child.kill();
    }

    private onMessage(rawMessage: unknown): void {
        if (rawMessage === null || typeof rawMessage !== "object") {
            this.fail(new Error("Native proxy returned an invalid message"));
            return;
        }
        const message = rawMessage as NativeProxyMessage;
        if (message.type === "ready") {
            this.resolveReady();
            return;
        }
        if (!Number.isSafeInteger(message.id)) {
            this.fail(new Error("Native proxy response is missing a valid request ID"));
            return;
        }
        const id = message.id!;
        const pending = this.pending.get(id);
        if (pending === undefined) {
            this.fail(new Error(`Native proxy returned unknown request ID ${id}`));
            return;
        }
        this.pending.delete(id);
        clearTimeout(pending.timeout);
        if (message.error !== undefined) {
            pending.reject(new Error(message.error));
            return;
        }
        if (!(message.body instanceof Uint8Array) || !Array.isArray(message.headers) ||
            typeof message.status !== "number" || typeof message.statusText !== "string") {
            pending.reject(new Error(`Native proxy returned an invalid response for request ${id}`));
            return;
        }
        pending.resolve({
            body: message.body,
            headers: message.headers,
            status: message.status,
            statusText: message.statusText,
        });
    }

    private fail(error: Error): void {
        if (this.closed) return;
        this.closed = true;
        this.rejectReady(error);
        this.rejectPending(error);
    }

    private rejectPending(error: Error): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
    }
}
