import { stringifyError } from '../logger/logger.js';
import { ClientOptions, HttpClient, HttpFetchResult } from './http_client.js';

/// The number of requests that the log keeps, older requests are dropped
export const HTTP_REQUEST_LOG_LIMIT = 500;
/// The bytes of a response body that the log keeps
export const HTTP_RESPONSE_PREVIEW_BYTES = 16 * 1024;
/// The bytes of a request body that the log keeps, curl commands need the whole body
export const HTTP_REQUEST_BODY_BYTES = 1024 * 1024;

/// The headers whose values are masked in the viewer, copy as curl keeps them
const SENSITIVE_HEADERS = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-trino-extra-credential',
]);

/// A body of a request or a response
export type HttpBodyRecord =
    /// A text body, `byteLength` is the size of the whole body
    | { kind: 'text'; text: string; byteLength: number; truncated: boolean }
    /// A binary body
    | { kind: 'binary'; byteLength: number }
    /// A JSON body that the caller parsed, the log does not keep it
    | { kind: 'parsed' }
    /// A body that the log cannot read without consuming it
    | { kind: 'opaque' };

/// A recorded http request
export interface HttpRequestEntry {
    /// The id of the request
    requestId: number;
    /// The method
    method: string;
    /// The url
    url: string;
    /// The request headers
    requestHeaders: [string, string][];
    /// The request body
    requestBody: HttpBodyRecord | null;
    /// When the request was sent
    sentAt: Date;
    /// When the response headers arrived
    respondedAt: Date | null;
    /// When the response body was read
    bodyReceivedAt: Date | null;
    /// When the request failed
    failedAt: Date | null;
    /// The response status
    status: number | null;
    /// The response status text
    statusText: string | null;
    /// The response headers
    responseHeaders: [string, string][] | null;
    /// The start of the response body, read when the caller reads it, error bodies are read right away
    responseBody: HttpBodyRecord | null;
    /// The error of a failed request
    error: string | null;
}

/// The outgoing http requests of the app
export class HttpRequestLog {
    private readonly entries = new Map<number, HttpRequestEntry>();
    private snapshot: readonly HttpRequestEntry[] = [];
    private readonly listeners = new Set<() => void>();
    private nextRequestId = 1;
    private readonly limit: number;

    constructor(limit: number = HTTP_REQUEST_LOG_LIMIT) {
        this.limit = limit;
    }

    /// The requests, oldest first
    readonly getSnapshot = (): readonly HttpRequestEntry[] => this.snapshot;

    /// Subscribe to changes
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    /// Record a sent request
    add(entry: Omit<HttpRequestEntry, 'requestId'>): number {
        const requestId = this.nextRequestId++;
        this.entries.set(requestId, { ...entry, requestId });
        // Maps iterate in insertion order, the first key is the oldest request
        while (this.entries.size > this.limit) {
            this.entries.delete(this.entries.keys().next().value!);
        }
        this.publish();
        return requestId;
    }

    /// Update a request, a dropped request is ignored
    update(requestId: number, patch: Partial<Omit<HttpRequestEntry, 'requestId'>>): void {
        const entry = this.entries.get(requestId);
        if (entry == null) return;
        this.entries.set(requestId, { ...entry, ...patch });
        this.publish();
    }

    /// Drop all requests
    clear(): void {
        this.entries.clear();
        this.publish();
    }

    private publish(): void {
        this.snapshot = [...this.entries.values()];
        for (const listener of this.listeners) listener();
    }
}

/// An http client that records its requests in a log
export class RecordingHttpClient implements HttpClient {
    constructor(private readonly inner: HttpClient, private readonly log: HttpRequestLog) { }

    async fetch(input: URL | Request | string, init?: RequestInit & ClientOptions): Promise<HttpFetchResult> {
        const request = input instanceof Request ? input : null;
        const headers = new Headers(request?.headers);
        new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
        // The content type that fetch derives from the body
        const bodyContentType = init?.body != null ? implicitContentType(init.body) : null;
        if (bodyContentType != null && !headers.has('content-type')) headers.set('content-type', bodyContentType);
        const requestId = this.log.add({
            method: (init?.method ?? request?.method ?? 'GET').toUpperCase(),
            url: request?.url ?? input.toString(),
            requestHeaders: [...headers.entries()],
            requestBody: init?.body != null
                ? recordRequestBody(init.body, headers.get('content-type'))
                : request?.body != null ? { kind: 'opaque' } : null,
            sentAt: new Date(),
            respondedAt: null,
            bodyReceivedAt: null,
            failedAt: null,
            status: null,
            statusText: null,
            responseHeaders: null,
            responseBody: null,
            error: null,
        });
        let response: HttpFetchResult;
        try {
            response = await this.inner.fetch(input, init);
        } catch (e: unknown) {
            this.log.update(requestId, { failedAt: new Date(), error: stringifyError(e) });
            throw e;
        }
        this.log.update(requestId, {
            respondedAt: new Date(),
            status: response.status,
            statusText: response.statusText,
            responseHeaders: [...response.headers.entries()],
        });
        return new RecordedHttpFetchResult(response, this.log, requestId);
    }
}

/// A response that records its body when the caller reads it
class RecordedHttpFetchResult implements HttpFetchResult {
    /// The body of an error response, read right away since callers often throw without reading it
    private readonly bufferedBody: Promise<ArrayBuffer> | null = null;

    constructor(private readonly inner: HttpFetchResult, private readonly log: HttpRequestLog, private readonly requestId: number) {
        if (inner.status >= 400) {
            this.bufferedBody = this.record(inner.arrayBuffer(), buffer => recordBytes(buffer, this.contentType, HTTP_RESPONSE_PREVIEW_BYTES));
            // The caller sees a failed read when it reads the body
            this.bufferedBody.catch(() => { });
        }
    }

    get headers(): Headers { return this.inner.headers; }
    get status(): number { return this.inner.status; }
    get statusText(): string { return this.inner.statusText; }
    private get contentType(): string | null { return this.inner.headers.get('content-type'); }

    arrayBuffer(): Promise<ArrayBuffer> {
        return this.bufferedBody ?? this.record(this.inner.arrayBuffer(), buffer => recordBytes(buffer, this.contentType, HTTP_RESPONSE_PREVIEW_BYTES));
    }

    async text(): Promise<string> {
        if (this.bufferedBody != null) return new TextDecoder().decode(await this.bufferedBody);
        return this.record(this.inner.text(), text => recordText(text, HTTP_RESPONSE_PREVIEW_BYTES));
    }

    async json(): Promise<any> {
        if (this.bufferedBody != null) {
            const text = new TextDecoder().decode(await this.bufferedBody);
            return text == '' ? {} : JSON.parse(text);
        }
        // Parsed bodies are not stringified again, they can be large
        return this.record(this.inner.json(), () => ({ kind: 'parsed' }));
    }

    /// Record the body once it is read
    private record<T>(body: Promise<T>, toRecord: (body: T) => HttpBodyRecord): Promise<T> {
        return body.then(
            value => {
                this.log.update(this.requestId, { bodyReceivedAt: new Date(), responseBody: toRecord(value) });
                return value;
            },
            (e: unknown) => {
                this.log.update(this.requestId, { failedAt: new Date(), error: stringifyError(e) });
                throw e;
            },
        );
    }
}

/// Is a body of this content type text?
function isTextContentType(contentType: string | null): boolean {
    if (contentType == null) return false;
    const mime = contentType.split(';')[0].trim().toLowerCase();
    return mime.startsWith('text/')
        || mime == 'application/json'
        || mime.endsWith('+json')
        || mime == 'application/xml'
        || mime.endsWith('+xml')
        || mime == 'application/x-www-form-urlencoded'
        || mime == 'application/javascript'
        || mime == 'application/graphql';
}

/// Record a text body, keep at most `limit` characters
function recordText(text: string, limit: number): HttpBodyRecord {
    const byteLength = new TextEncoder().encode(text).byteLength;
    return { kind: 'text', text: text.length > limit ? text.slice(0, limit) : text, byteLength, truncated: text.length > limit };
}

/// Record a byte body, it is text if the content type says so
function recordBytes(bytes: ArrayBuffer | ArrayBufferView, contentType: string | null, limit: number): HttpBodyRecord {
    const view = bytes instanceof ArrayBuffer
        ? new Uint8Array(bytes)
        : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // An empty body without content type is no body
    if (!isTextContentType(contentType) && view.byteLength > 0) return { kind: 'binary', byteLength: view.byteLength };
    const truncated = view.byteLength > limit;
    // A cut through a multi-byte character decodes as a replacement character
    const text = new TextDecoder().decode(truncated ? view.subarray(0, limit) : view);
    return { kind: 'text', text, byteLength: view.byteLength, truncated };
}

/// Record a request body, a body is text unless it is binary data of a content type that is not text
function recordRequestBody(body: BodyInit, contentType: string | null): HttpBodyRecord {
    if (typeof body == 'string') return recordText(body, HTTP_REQUEST_BODY_BYTES);
    if (body instanceof URLSearchParams) return recordText(body.toString(), HTTP_REQUEST_BODY_BYTES);
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return recordBytes(body, contentType, HTTP_REQUEST_BODY_BYTES);
    if (body instanceof Blob) return { kind: 'binary', byteLength: body.size };
    return { kind: 'opaque' };
}

/// The content type that fetch sends for a body without content type header
function implicitContentType(body: BodyInit): string | null {
    if (typeof body == 'string') return 'text/plain;charset=UTF-8';
    if (body instanceof URLSearchParams) return 'application/x-www-form-urlencoded;charset=UTF-8';
    if (body instanceof Blob && body.type != '') return body.type;
    return null;
}

/// Is the value of a header masked in the viewer?
export function isSensitiveHeader(name: string): boolean {
    return SENSITIVE_HEADERS.has(name.toLowerCase());
}

/// Mask the values of sensitive headers
export function maskHeaders(headers: [string, string][]): [string, string][] {
    return headers.map(([name, value]) => [name, isSensitiveHeader(name) ? '••••••••' : value]);
}

/// Quote a word for POSIX shells
function shellQuote(word: string): string {
    return `'${word.replace(/'/g, `'\\''`)}'`;
}

/// Format a request as a curl command. The command includes the values of sensitive headers.
export function formatCurlCommand(entry: HttpRequestEntry): string {
    const notes: string[] = [];
    const args: string[] = [`curl ${shellQuote(entry.url)}`];
    const body = entry.requestBody;
    // curl sends a POST when it has data
    if (entry.method != 'GET' && !(entry.method == 'POST' && body?.kind == 'text')) {
        args.push(`-X ${entry.method}`);
    }
    for (const [name, value] of entry.requestHeaders) {
        args.push(`-H ${shellQuote(`${name}: ${value}`)}`);
    }
    switch (body?.kind) {
        case 'text':
            if (body.truncated) notes.push(`# The request body is cut to ${body.text.length} of ${body.byteLength} bytes`);
            args.push(`--data-raw ${shellQuote(body.text)}`);
            break;
        case 'binary':
            notes.push(`# The binary request body of ${body.byteLength} bytes is left out`);
            break;
        case 'opaque':
            notes.push('# The request body is left out, the log could not read it');
            break;
    }
    return [...notes, args.join(' \\\n  ')].join('\n');
}
