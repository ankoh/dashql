import { ChannelArgs, ChannelError, RawProxyError } from '@akohn/dashql/platform/channel_common';
import { Logger } from "@akohn/dashql/platform/logger/logger";
import { HEADER_NAME_BATCH_BYTES, HEADER_NAME_BATCH_EVENT, HEADER_NAME_BATCH_MESSAGES, HEADER_NAME_BATCH_TIMEOUT, HEADER_NAME_CHANNEL_ID, HEADER_NAME_ERROR, HEADER_NAME_GRPC_STATUS, HEADER_NAME_ENDPOINT, HEADER_NAME_PATH, HEADER_NAME_READ_TIMEOUT, HEADER_NAME_STREAM_ID, HEADER_NAME_TLS, HEADER_NAME_TLS_CACERTS, HEADER_NAME_TLS_CLIENT_CERT, HEADER_NAME_TLS_CLIENT_KEY, NativeStreamBatchEvent } from './native_proxy_headers.js';
import { NATIVE_PROXY_ENDPOINT, nativeProxyFetch } from './electron_native_fetch.js';

const LOG_CTX = 'native_grpc_client';

export interface NativeGrpcServerStreamBatch {
    /// The batch event
    event: NativeStreamBatchEvent;
    /// The messages
    messages: Uint8Array[];
    /// The trailers (if any)
    metadata?: Record<string, string>;
}

export interface NativeGrpcServerStreamOptions {
    readTimeoutMs?: number;
}

const DEFAULT_READ_TIMEOUT = 60_000;
const DEFAULT_BATCH_TIMEOUT = 100;
const DEFAULT_BATCH_BYTES = 8000000;

function requireStringHeader(headers: Headers, key: string): string {
    return headers.get(key)!;
}
function requireIntegerHeader(headers: Headers, key: string): number {
    const raw = headers.get(key)!;
    return Number.parseInt(raw);
}
async function throwIfError(response: Response): Promise<void> {
    if (response.headers.get(HEADER_NAME_ERROR) ?? false) {
        const proxyError = await response.json() as RawProxyError;
        const statusCode = requireIntegerHeader(response.headers, HEADER_NAME_GRPC_STATUS);
        throw new ChannelError(proxyError, statusCode, response.headers, LOG_CTX);
    } else if (response.status != 200) {
        const proxyError: RawProxyError = {
            message: response.statusText
        };
        throw new ChannelError(proxyError, 500, response.headers, LOG_CTX);
    }
}

export class NativeGrpcServerStream implements AsyncIterator<NativeGrpcServerStreamBatch> {
    /// The logger
    logger: Logger;
    /// The channel id
    channelId: number;
    /// The stream id
    streamId: number;
    /// The headers of every request, e.g. the metadata of the connection
    requestHeaders: Record<string, string>;
    /// Maximum time to wait for the next stream batch.
    readTimeoutMs: number;
    /// Reached the end of the stream?
    reachedEndOfStream: boolean;

    constructor(channelId: number, streamId: number, requestHeaders: Record<string, string>, logger: Logger, options: NativeGrpcServerStreamOptions = {}) {
        this.logger = logger;
        this.channelId = channelId;
        this.streamId = streamId;
        this.requestHeaders = requestHeaders;
        this.readTimeoutMs = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT;
        this.reachedEndOfStream = false;
    }

    /// Read the next messages from the stream
    public async read(): Promise<NativeGrpcServerStreamBatch> {
        const url = new URL(NATIVE_PROXY_ENDPOINT);
        url.pathname = `/grpc/channel/${this.channelId}/stream/${this.streamId}`;
        const headers = new Headers({
            ...this.requestHeaders,
            [HEADER_NAME_READ_TIMEOUT]: this.readTimeoutMs.toString(),
            [HEADER_NAME_BATCH_TIMEOUT]: DEFAULT_BATCH_TIMEOUT.toString(),
            [HEADER_NAME_BATCH_BYTES]: DEFAULT_BATCH_BYTES.toString(),
        });
        const request = new Request(url, {
            method: 'GET',
            headers
        });
        const response = await nativeProxyFetch(request);
        await throwIfError(response);

        const streamBatchEvent = requireStringHeader(response.headers, HEADER_NAME_BATCH_EVENT);
        const streamBatchMessages = requireIntegerHeader(response.headers, HEADER_NAME_BATCH_MESSAGES);
        const bodyBuffer = await response.arrayBuffer();
        const bodyBufferView = new DataView(bodyBuffer);

        // Unpack the messages
        let offset = 0;
        const messages = [];
        while (offset < bodyBuffer.byteLength) {
            const length = bodyBufferView.getUint32(offset, true);
            offset += 4;
            messages.push(new Uint8Array(bodyBuffer, offset, length));
            offset += length;
        }

        // Message count mismatch?
        // We treat this as an error since this means our encoded response buffer is corrupt.
        if (streamBatchMessages != messages.length) {
            // Fatal error, silently drop the stream
            const url = new URL(NATIVE_PROXY_ENDPOINT);
            url.pathname = `/grpc/channel/${this.channelId}/stream/${this.streamId}`;
            const request = new Request(url, {
                method: 'DELETE'
            });
            await nativeProxyFetch(request);
            // XXX Log if the dropping failed
            throw new ChannelError({ message: "batch message count mismatch" }, 13, undefined, LOG_CTX);
        }

        // Return the batch event and all messages
        const metadata: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            metadata[key] = value;
        });

        // Return the batch event and all messages
        return {
            event: streamBatchEvent as NativeStreamBatchEvent,
            messages: messages,
            metadata
        };
    }

    /// Get the next batch
    public async next(): Promise<IteratorResult<NativeGrpcServerStreamBatch>> {
        if (this.reachedEndOfStream) {
            return { value: undefined, done: true };
        }
        const batch = await this.read();
        switch (batch.event) {
            case NativeStreamBatchEvent.FlushAfterBytes:
            case NativeStreamBatchEvent.FlushAfterTimeout:
                return { value: batch, done: false };

            case NativeStreamBatchEvent.StreamFinished:
            case NativeStreamBatchEvent.FlushAfterClose:
                this.reachedEndOfStream = true;
                return { value: batch, done: false };

            case NativeStreamBatchEvent.StreamFailed:
                this.reachedEndOfStream = true;
                throw new ChannelError({ message: "stream failed" }, 400, new Headers(batch.metadata));
        }
    }

    public async destroy(): Promise<void> {
        if (this.reachedEndOfStream) return;
        this.reachedEndOfStream = true;
        const url = new URL(NATIVE_PROXY_ENDPOINT);
        url.pathname = `/grpc/channel/${this.channelId}/stream/${this.streamId}`;
        const response = await nativeProxyFetch(new Request(url, { method: 'DELETE' }));
        await throwIfError(response);
    }
}

export class NativeGrpcServerStreamMessageIterator implements AsyncIterator<Uint8Array> {
    /// The logger
    protected logger: Logger;
    /// The batch iterator
    protected batchIterator: AsyncIterator<NativeGrpcServerStreamBatch>;
    /// The current batch
    protected currentBatch: NativeGrpcServerStreamBatch | null;
    /// The next index in the current batch
    protected nextInCurrentBatch: number;
    /// The combined metadata
    public metadata: Map<string, string>;

    constructor(batchIterator: AsyncIterator<NativeGrpcServerStreamBatch>, logger: Logger) {
        this.logger = logger;
        this.batchIterator = batchIterator;
        this.currentBatch = null;
        this.nextInCurrentBatch = 0;
        this.metadata = new Map();
    }

    /// Get the bytes from the next message in the gRPC stream
    async next(): Promise<IteratorResult<Uint8Array>> {
        while (true) {
            // Fast path, we still have a buffered message
            if (this.currentBatch !== null && this.nextInCurrentBatch < this.currentBatch.messages.length) {
                const mId = this.nextInCurrentBatch;
                this.nextInCurrentBatch += 1;
                return { value: this.currentBatch.messages[mId], done: false };
            }
            this.currentBatch = null;
            this.nextInCurrentBatch = 0;

            // Otherwise, get a new batch
            const result = await this.batchIterator.next();
            if (result.done) {
                return { value: undefined, done: true, }
            } else {
                this.currentBatch = result.value;
                this.nextInCurrentBatch = 0;
                if (result.value.metadata) {
                    for (const key in result.value.metadata) {
                        this.metadata.set(key, result.value.metadata[key]);
                    }
                }
            }
        }
    }
}

interface StartServerStreamArgs {
    /// The path
    path: string;
    /// The request body
    body: Uint8Array;
    /// Maximum time to wait for the next stream batch.
    readTimeoutMs?: number;
}

export class NativeGrpcChannel {
    /// The logger
    logger: Logger;
    /// The headers of every request, e.g. the metadata of the connection
    requestHeaders: Record<string, string>;
    /// The channel id
    channelId: number;

    constructor(channelId: number, requestHeaders: Record<string, string>, logger: Logger) {
        this.logger = logger;
        this.requestHeaders = requestHeaders;
        this.channelId = channelId;
    }

    /// Call a server streaming.
    public async startServerStream(args: StartServerStreamArgs): Promise<NativeGrpcServerStream> {
        const url = new URL(NATIVE_PROXY_ENDPOINT);
        url.pathname = `/grpc/channel/${this.channelId}/streams`;

        // Collect the request headers
        const headers = new Headers(this.requestHeaders);
        headers.set(HEADER_NAME_CHANNEL_ID, this.channelId.toString());
        headers.set(HEADER_NAME_PATH, args.path);

        // Send the request
        const request = new Request(url, {
            method: 'POST',
            headers,
            body: args.body as BodyInit,
        });
        const response = await nativeProxyFetch(request);
        await throwIfError(response);

        const streamId = requireIntegerHeader(response.headers, HEADER_NAME_STREAM_ID);
        return new NativeGrpcServerStream(this.channelId, streamId, this.requestHeaders, this.logger, {
            readTimeoutMs: args.readTimeoutMs,
        });
    }

    // Destroy a channel
    public async close(): Promise<void> {
        const url = new URL(NATIVE_PROXY_ENDPOINT);
        url.pathname = `/grpc/channel/${this.channelId}`;

        const headers = new Headers();
        headers.set(HEADER_NAME_CHANNEL_ID, this.channelId.toString());

        // Send the request
        const request = new Request(url, {
            method: 'DELETE',
            headers,
            body: "",
        });
        const response = await nativeProxyFetch(request);
        await throwIfError(response);
    }
}

export class NativeGrpcClient {
    /// The logger
    logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /// Create a gRPC channel, its requests carry the request headers, e.g. the metadata of the connection
    public async connect(args: ChannelArgs, requestHeaders: Record<string, string>): Promise<NativeGrpcChannel> {
        const url = new URL(NATIVE_PROXY_ENDPOINT);
        url.pathname = `/grpc/channels`;

        // Set system headers
        const headers = new Headers(requestHeaders);
        headers.set(HEADER_NAME_ENDPOINT, args.endpoint);
        if (args.tls) {
            headers.set(HEADER_NAME_TLS, "1");
            if (args.tls.keyPath && args.tls.keyPath !== "") {
                headers.set(HEADER_NAME_TLS_CLIENT_KEY, args.tls.keyPath);
            }
            if (args.tls.pubPath && args.tls.pubPath !== "") {
                headers.set(HEADER_NAME_TLS_CLIENT_CERT, args.tls.pubPath);
            }
            if (args.tls.caPath && args.tls.caPath !== "") {
                headers.set(HEADER_NAME_TLS_CACERTS, args.tls.caPath);
            }
        }
        const request = new Request(url, {
            method: 'POST',
            headers
        });
        const response = await nativeProxyFetch(request);
        await throwIfError(response);

        const channelId = requireIntegerHeader(response.headers, HEADER_NAME_CHANNEL_ID);
        return new NativeGrpcChannel(channelId, requestHeaders, this.logger);
    }
}
