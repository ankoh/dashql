import { DetailedError } from '../../utils/error.js';
import { getProxyErrorData, RawProxyError } from '../channel_common.js';
import { HttpClient, HttpFetchResult } from './http_client.js';
import { Logger } from '../logger/logger.js';
import { HEADER_NAME_BATCH_BYTES, HEADER_NAME_BATCH_EVENT, HEADER_NAME_BATCH_TIMEOUT, HEADER_NAME_ENDPOINT, HEADER_NAME_ERROR, HEADER_NAME_METHOD, HEADER_NAME_PATH, HEADER_NAME_READ_TIMEOUT, HEADER_NAME_RESPONSE_STARTED, HEADER_NAME_SEARCH_PARAMS, HEADER_NAME_STREAM_ID } from '../native_proxy_headers.js';
import { nativeProxyFetch } from '../electron_native_fetch.js';

export enum NativeHttpServerStreamBatchEvent {
    StreamFailed = "StreamFailed",
    StreamFinished = "StreamFinished",
    FlushAfterClose = "FlushAfterClose",
    FlushAfterTimeout = "FlushAfterTimeout",
    FlushAfterBytes = "FlushAfterBytes",
}

export interface NativeHttpProxyConfig {
    /// The endpoint URL
    proxyEndpoint: URL;
};

export class NativeHttpError extends Error implements DetailedError {
    /// The data
    data: Record<string, string>;

    constructor(o: RawProxyError) {
        super(o.message);
        this.data = getProxyErrorData(o);
    }
}

export class NativeHttpServerStream implements HttpFetchResult {
    /// The endpoint
    endpoint: NativeHttpProxyConfig;
    /// The stream id
    streamId: number | null;
    /// The headers
    headers: Headers;
    /// The status
    status: number;
    /// The status text
    statusText: string;
    /// The native http error (if any)
    initialErrorBody: RawProxyError | null;
    /// The logger
    logger: Logger;
    /// The text decoder for decoding utf8
    textDecoder: TextDecoder;
    /// Body bytes received while loading the upstream response headers
    initialBody: ArrayBuffer | null;
    /// Whether more response batches need to be fetched
    fetchNext: boolean;
    /// Proxy error deferred until the response body is consumed
    deferredError: NativeHttpError | null;

    /// Constructor
    constructor(endpoint: NativeHttpProxyConfig, streamId: number | null, headers: Headers, status: number, statusText: string, initialErrorBody: RawProxyError | null, logger: Logger) {
        this.headers = headers;
        this.status = status;
        this.statusText = statusText;
        this.initialErrorBody = initialErrorBody;
        this.endpoint = endpoint;
        this.streamId = streamId;
        this.logger = logger;
        this.textDecoder = new TextDecoder();
        this.initialBody = null;
        this.fetchNext = streamId != null;
        this.deferredError = null;
    }

    private updateFetchState(batchEvent: string | null): void {
        switch (batchEvent) {
            case NativeHttpServerStreamBatchEvent.StreamFailed:
            case NativeHttpServerStreamBatchEvent.StreamFinished:
            case NativeHttpServerStreamBatchEvent.FlushAfterClose:
                this.fetchNext = false;
                break;
            case NativeHttpServerStreamBatchEvent.FlushAfterTimeout:
            case NativeHttpServerStreamBatchEvent.FlushAfterBytes:
                this.fetchNext = true;
                break;
        }
    }

    private async readNextBatch(): Promise<{ response: Response; buffer: ArrayBuffer }> {
        const url = new URL(this.endpoint.proxyEndpoint);
        url.pathname = `/http/stream/${this.streamId}`;
        const headers = new Headers();
        headers.set(HEADER_NAME_BATCH_BYTES, "4000000"); // 4 MB
        headers.set(HEADER_NAME_BATCH_TIMEOUT, "1000");
        headers.set(HEADER_NAME_READ_TIMEOUT, "10000");

        const response = await nativeProxyFetch(new Request(url, {
            method: 'GET',
            headers,
        }));
        if (response.headers.get(HEADER_NAME_ERROR) ?? false) {
            const proxyError = await response.json() as RawProxyError;
            throw new NativeHttpError(proxyError);
        }

        const batchEvent = response.headers.get(HEADER_NAME_BATCH_EVENT);
        this.logger.debug("Received fetch response", { "event": batchEvent }, "native_http_client");
        this.updateFetchState(batchEvent);
        return { response, buffer: await response.arrayBuffer() };
    }

    async initialize(): Promise<void> {
        if (this.streamId == null) {
            return;
        }
        const chunks = [];
        let totalChunkBytes = 0;
        while (this.fetchNext) {
            let response: Response;
            let buffer: ArrayBuffer;
            try {
                ({ response, buffer } = await this.readNextBatch());
            } catch (error) {
                if (error instanceof NativeHttpError) {
                    this.deferredError = error;
                    return;
                }
                throw error;
            }
            chunks.push(buffer);
            totalChunkBytes += buffer.byteLength;
            if (response.headers.has(HEADER_NAME_RESPONSE_STARTED)) {
                this.headers = response.headers;
                this.status = response.status;
                this.statusText = response.statusText;
                break;
            }
        }

        const combined = new Uint8Array(totalChunkBytes);
        let offset = 0;
        for (const chunk of chunks) {
            combined.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }
        this.initialBody = combined.buffer;
    }

    async json(): Promise<any> {
        if (this.initialErrorBody != null) {
            return this.initialErrorBody;
        }
        const buffer = await this.arrayBuffer();
        const text = this.textDecoder.decode(buffer);
        if (text == "") {
            this.logger.debug(`Response body is empty`, {});
            return {};
        } else {
            return JSON.parse(text);
        }
    }

    async text(): Promise<any> {
        if (this.initialErrorBody != null) {
            return this.initialErrorBody;
        }
        const buffer = await this.arrayBuffer();
        return this.textDecoder.decode(buffer);
    }

    /// Get the response as array buffer
    async arrayBuffer(): Promise<ArrayBuffer> {
        if (this.deferredError != null) {
            throw this.deferredError;
        }
        if (this.streamId == null) {
            return new ArrayBuffer(0);
        }

        const chunks = [];
        let totalChunkBytes = 0;
        if (this.initialBody != null) {
            chunks.push(this.initialBody);
            totalChunkBytes += this.initialBody.byteLength;
            this.initialBody = null;
        }

        // Fetch all the chunks
        while (this.fetchNext) {
            const { buffer } = await this.readNextBatch();
            chunks.push(buffer)
            totalChunkBytes += buffer.byteLength;
        }


        // Combine buffers
        const combined = new Uint8Array(new ArrayBuffer(totalChunkBytes));
        let combinedWriter = 0;
        for (const chunk of chunks) {
            combined.set(new Uint8Array(chunk), combinedWriter);
            combinedWriter += chunk.byteLength;
        }

        return combined.buffer;
    }
}

export class NativeHttpClient implements HttpClient {
    /// The logger
    logger: Logger;
    /// The endpoint
    endpoint: NativeHttpProxyConfig;
    /// The text encoder
    encoder: TextEncoder;

    /// Constructor
    constructor(proxy: NativeHttpProxyConfig, logger: Logger) {
        this.logger = logger;
        this.endpoint = proxy;
        this.encoder = new TextEncoder();
    }

    public async fetch(input: URL, init?: RequestInit): Promise<HttpFetchResult> {
        const url = new URL(this.endpoint.proxyEndpoint);
        url.pathname = `/http/streams`;
        const remote = `${input.protocol}//${input.host}`;

        const headers = new Headers(init?.headers);
        headers.set(HEADER_NAME_METHOD, init?.method ?? "GET");
        headers.set(HEADER_NAME_ENDPOINT, remote);
        headers.set(HEADER_NAME_PATH, input.pathname);
        headers.set(HEADER_NAME_SEARCH_PARAMS, input.searchParams.toString());
        headers.set(HEADER_NAME_BATCH_TIMEOUT, "1000");
        headers.set(HEADER_NAME_READ_TIMEOUT, "10000");

        this.logger.debug(`Fetching http stream`, { "remote": remote, "path": input?.toString() }, "native_http_client");

        const body: any = init?.body;
        let bodyBuffer: ArrayBuffer | Uint8Array;
        if (init?.body) {
            if (init.body instanceof ArrayBuffer) {
                bodyBuffer = init.body;
            } else if (init.body instanceof URLSearchParams) {
                bodyBuffer = new TextEncoder().encode(body.toString());
            } else if (typeof init.body == "string") {
                bodyBuffer = new TextEncoder().encode(body);
            } else {
                throw Error("Fetched body is of unexpected type");
            }
        }

        const request = new Request(url, {
            method: 'POST',
            headers,
            body: init?.body
        });
        const response = await nativeProxyFetch(request);

        // Parse the stream id
        let streamId: number | null = null;
        if (response.status == 200) {
            const streamIdText = response.headers.get(HEADER_NAME_STREAM_ID);
            if (streamIdText == null) {
                this.logger.error("Fetch returned with status 200 but did not include a stream id", {}, "native_http_client");
                throw new Error("Missing stream id");
            }
            streamId = Number.parseInt(streamIdText);

            const stream = new NativeHttpServerStream(this.endpoint, streamId, response.headers, response.status, response.statusText, null, this.logger);
            await stream.initialize();
            return stream;
        } else {
            let rawProxyError: any | null = null;
            if (response.headers.get(HEADER_NAME_ERROR) ?? false) {
                rawProxyError = await response.json() as RawProxyError;
            }
            return new NativeHttpServerStream(this.endpoint, streamId, response.headers, response.status, response.statusText, rawProxyError, this.logger);;
        }
    }
}
