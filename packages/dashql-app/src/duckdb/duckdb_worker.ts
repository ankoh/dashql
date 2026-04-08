import {
    WebDBWorkerRequestType,
    WebDBWorkerRequestVariant,
    WebDBWorkerResponseType,
    WebDBWorkerResponseVariant,
} from './duckdb_worker_request.js';
import createDuckDBModule from '@dashql/duckdb-wasm-js';
// eslint-disable-next-line import/no-unresolved -- resolved by bundler
import webdbWasmJsUrl from '@dashql/duckdb-wasm-js?url';

export interface MessageEventLike<T = any> {
    data: T;
}

export interface WorkerGlobalsLike {
    postMessage(message: any, transfer: Transferable[]): void;
    addEventListener(channel: 'message', handler: (event: MessageEventLike) => void): void;
    removeEventListener(channel: 'message', handler: (event: MessageEventLike) => void): void;
}

// Emscripten module interface
interface EmscriptenModule {
    HEAP8: Int8Array;
    HEAPU8: Uint8Array;
    HEAP16: Int16Array;
    HEAPU16: Uint16Array;
    HEAP32: Int32Array;
    HEAPU32: Uint32Array;
    HEAPF32: Float32Array;
    HEAPF64: Float64Array;

    memory: WebAssembly.Memory;

    _malloc: (size: number) => number;
    _free: (ptr: number) => void;

    // WebDB API functions
    _duckdb_web_clear_response: () => void;
    _duckdb_web_reset: (packedPtr: number) => void;
    _duckdb_web_connect: () => number;
    _duckdb_web_disconnect: (connHdl: number) => void;
    _duckdb_web_open: (packedPtr: number, argsJson: number) => void;
    _duckdb_web_get_version: (packedPtr: number) => void;

    _duckdb_web_query_run_buffer: (packedPtr: number, connHdl: number, buffer: number, bufferLength: number) => void;
    _duckdb_web_pending_query_start_buffer: (packedPtr: number, connHdl: number, buffer: number, bufferLength: number, allowStreamResult: boolean) => void;
    _duckdb_web_pending_query_poll: (packedPtr: number, connHdl: number, script: number) => void;
    _duckdb_web_pending_query_cancel: (connHdl: number, script: number) => boolean;
    _duckdb_web_query_fetch_results: (packedPtr: number, connHdl: number) => void;

    _duckdb_web_prepared_create_buffer: (packedPtr: number, connHdl: number, buffer: number, bufferLength: number) => void;
    _duckdb_web_prepared_run: (packedPtr: number, connHdl: number, statementId: number, argsJson: number) => void;
    _duckdb_web_prepared_send: (packedPtr: number, connHdl: number, statementId: number, argsJson: number) => void;
    _duckdb_web_prepared_close: (packedPtr: number, connHdl: number, statementId: number) => void;

    _duckdb_web_insert_arrow_from_ipc_stream: (packedPtr: number, connHdl: number, buffer: number, bufferLength: number, options: number) => void;
}

// WASMResponse struct (matches C++ struct)
interface WASMResponse {
    statusCode: number;
    dataOrValue: number;
    dataSize: number;
}

export class DuckDBWorker {
    protected workerGlobals: WorkerGlobalsLike;
    protected readonly onMessageHandler: (event: MessageEventLike) => void;

    protected nextMessageId = 0;
    protected module: EmscriptenModule | null = null;
    protected threadPoolSize = 0;
    protected encoder: TextEncoder;
    protected decoder: TextDecoder;
    // Test-only: allow injecting WASM binary directly
    public testWasmBinary?: Uint8Array;

    constructor(workerGlobals: WorkerGlobalsLike) {
        this.workerGlobals = workerGlobals;
        this.nextMessageId = 0;
        this.encoder = new TextEncoder();
        this.decoder = new TextDecoder();

        this.onMessageHandler = this.onMessageEvent.bind(this);
    }

    public attach(): void {
        this.workerGlobals.addEventListener('message', this.onMessageHandler);
    }

    public detach(): void {
        this.workerGlobals.removeEventListener('message', this.onMessageHandler);
    }

    protected postMessage(response: WebDBWorkerResponseVariant, transfer: any[]): void {
        this.workerGlobals.postMessage(response, transfer);
    }

    protected sendOK(request: WebDBWorkerRequestVariant): void {
        this.postMessage(
            {
                messageId: this.nextMessageId++,
                requestId: request.messageId,
                type: WebDBWorkerResponseType.OK,
                data: null,
            },
            [],
        );
    }

    protected failWith(request: WebDBWorkerRequestVariant, e: Error): void {
        const obj: any = {
            name: e.name,
            message: e.message,
            stack: e.stack || undefined,
        };
        this.postMessage(
            {
                messageId: this.nextMessageId++,
                requestId: request.messageId,
                type: WebDBWorkerResponseType.ERROR,
                data: obj,
            },
            [],
        );
    }

    protected copyString(text: string): [number, number] {
        if (!this.module) throw new Error('Module not initialized');

        if (text.length === 0) {
            return [0, 0];
        }

        const bufferSize = text.length * 3 + 1;
        const textBegin = this.module._malloc(bufferSize);
        if (textBegin === 0) {
            throw new Error(`failed to allocate string of size ${text.length}`);
        }

        // With pthreads, WASM memory is SharedArrayBuffer, which cannot be used
        // directly with TextEncoder.encodeInto(). We must encode to a temporary
        // non-shared buffer first, then copy to shared memory.
        const tempBuffer = new Uint8Array(bufferSize);
        const textEncoded = this.encoder.encodeInto(text, tempBuffer);
        if (!textEncoded.written || textEncoded.written === 0) {
            this.module._free(textBegin);
            throw new Error(`failed to encode string of size ${text.length}`);
        }

        // Copy from temporary buffer to shared WASM memory
        const textBuffer = this.module.HEAPU8.subarray(textBegin, textBegin + bufferSize);
        textBuffer.set(tempBuffer.subarray(0, textEncoded.written + 1));
        textBuffer[textEncoded.written] = 0;
        return [textBegin, textEncoded.written];
    }

    protected copyBuffer(src: Uint8Array): [number, number] {
        if (!this.module) throw new Error('Module not initialized');

        if (src.length === 0) {
            return [0, 0];
        }

        const ptr = this.module._malloc(src.length);
        if (ptr === 0) {
            throw new Error(`failed to allocate buffer of size ${src.length}`);
        }

        const dst = this.module.HEAPU8.subarray(ptr, ptr + src.length);
        dst.set(src);
        return [ptr, src.length];
    }

    protected readResponse(packedPtr: number): WASMResponse {
        if (!this.module) throw new Error('Module not initialized');

        const heapF64 = this.module.HEAPF64;
        const offset = packedPtr / 8;

        return {
            statusCode: heapF64[offset],
            dataOrValue: heapF64[offset + 1],
            dataSize: heapF64[offset + 2],
        };
    }

    protected checkResponse(response: WASMResponse): void {
        if (response.statusCode !== 0) {
            const dataPtr = response.dataOrValue;
            const dataSize = response.dataSize;

            if (dataPtr !== 0 && dataSize > 0 && this.module) {
                const errorData = this.module.HEAPU8.subarray(dataPtr, dataPtr + dataSize);
                const errorMessage = this.decoder.decode(errorData);
                throw new Error(errorMessage);
            } else {
                throw new Error(`WebDB error with status code ${response.statusCode}`);
            }
        }
    }

    protected readArrowBuffer(response: WASMResponse): Uint8Array {
        if (!this.module) throw new Error('Module not initialized');

        const dataPtr = response.dataOrValue;
        const dataSize = response.dataSize;

        if (dataPtr === 0 || dataSize === 0) {
            return new Uint8Array(0);
        }

        const buffer = this.module.HEAPU8.subarray(dataPtr, dataPtr + dataSize);
        const copy = new Uint8Array(buffer);
        return copy;
    }

    public onMessageEvent(event: MessageEventLike) {
        this.onMessage(event.data);
    }

    public async onMessage(request: WebDBWorkerRequestVariant): Promise<void> {
        switch (request.type) {
            case WebDBWorkerRequestType.PING:
                this.sendOK(request);
                return;

            case WebDBWorkerRequestType.INSTANTIATE:
                try {
                    // Load the WASM module
                    const options: any = {};

                    // Tell Emscripten where to find the JS file for pthread workers.
                    // Only set mainScriptUrlOrBlob for proper absolute URLs (http/https/file/blob).
                    // In Vitest/Node.js, ?url imports return a Vite server-relative path like
                    // "/dependencies/dashql-duckdb/duckdb_web.js". Node.js Worker() treats that
                    // as an absolute filesystem path which does not exist, causing MODULE_NOT_FOUND.
                    // Leaving mainScriptUrlOrBlob unset lets Emscripten use import.meta.url from
                    // within duckdb_web.js itself, which Vite preserves as a file:// URL in Node.js.
                    const jsUrl = typeof webdbWasmJsUrl === 'string' ? webdbWasmJsUrl : new URL(webdbWasmJsUrl as string, self.location.href).href;
                    if (jsUrl.startsWith('http://') || jsUrl.startsWith('https://') || jsUrl.startsWith('file://') || jsUrl.startsWith('blob:')) {
                        options.mainScriptUrlOrBlob = jsUrl;
                    }

                    // Use injected binary for tests, or fetch via URL for production
                    if (this.testWasmBinary) {
                        options.wasmBinary = this.testWasmBinary;
                    } else if (request.data.wasmUrl) {
                        options.locateFile = (path: string) => {
                            if (path.endsWith('.wasm')) {
                                return request.data.wasmUrl;
                            }
                            return path;
                        };
                    }

                    this.module = await createDuckDBModule(options) as EmscriptenModule;
                    // Read the actual number of pre-spawned pthread workers so OPEN
                    // can cap DuckDB's task scheduler to exactly the available pool.
                    const pthreads = (this.module as any).PThread;
                    const spawnedCount: number = pthreads?.unusedWorkers?.length ?? 0;
                    if (spawnedCount === 0) {
                        throw new Error('WebDB WASM module initialized with no pre-spawned pthread workers. ' +
                            'Check PTHREAD_POOL_SIZE in packages/dashql-duckdb/BUILD.bazel.');
                    }
                    this.threadPoolSize = spawnedCount;
                    this.sendOK(request);
                } catch (e: any) {
                    this.failWith(request, e);
                }
                return;

            default:
                break;
        }

        if (!this.module) {
            this.failWith(request, new Error('Module not instantiated'));
            return;
        }

        try {
            // Allocate response buffer on stack (3 doubles = 24 bytes)
            const packedPtr = this.module._malloc(24);

            try {
                switch (request.type) {
                    case WebDBWorkerRequestType.OPEN: {
                        const openData: typeof request.data = (request.data.maximumThreads === undefined && this.threadPoolSize > 0)
                            ? { ...request.data, maximumThreads: this.threadPoolSize }
                            : request.data;
                        const config = JSON.stringify(openData);
                        const [configPtr] = this.copyString(config);
                        try {
                            this.module._duckdb_web_open(packedPtr, configPtr);
                            const response = this.readResponse(packedPtr);
                            this.checkResponse(response);
                            this.sendOK(request);
                        } finally {
                            if (configPtr !== 0) this.module._free(configPtr);
                        }
                        break;
                    }

                    case WebDBWorkerRequestType.RESET: {
                        this.module._duckdb_web_reset(packedPtr);
                        const response = this.readResponse(packedPtr);
                        this.checkResponse(response);
                        this.sendOK(request);
                        break;
                    }

                    case WebDBWorkerRequestType.GET_VERSION: {
                        this.module._duckdb_web_get_version(packedPtr);
                        const response = this.readResponse(packedPtr);
                        this.checkResponse(response);

                        const dataPtr = response.dataOrValue;
                        const dataSize = response.dataSize;
                        const versionData = this.module.HEAPU8.subarray(dataPtr, dataPtr + dataSize);
                        const version = this.decoder.decode(versionData);

                        this.postMessage(
                            {
                                messageId: this.nextMessageId++,
                                requestId: request.messageId,
                                type: WebDBWorkerResponseType.VERSION,
                                data: { version },
                            },
                            [],
                        );
                        break;
                    }

                    case WebDBWorkerRequestType.CONNECT: {
                        const connectionId = this.module._duckdb_web_connect();
                        if (connectionId === 0) {
                            throw new Error('Failed to create connection');
                        }
                        this.postMessage(
                            {
                                messageId: this.nextMessageId++,
                                requestId: request.messageId,
                                type: WebDBWorkerResponseType.CONNECTION_ID,
                                data: { connectionId },
                            },
                            [],
                        );
                        break;
                    }

                    case WebDBWorkerRequestType.DISCONNECT: {
                        this.module._duckdb_web_disconnect(request.data.connectionId);
                        this.sendOK(request);
                        break;
                    }

                    case WebDBWorkerRequestType.QUERY_RUN: {
                        const [queryPtr, queryLen] = this.copyBuffer(this.encoder.encode(request.data.query));
                        try {
                            this.module._duckdb_web_query_run_buffer(
                                packedPtr,
                                request.data.connectionId,
                                queryPtr,
                                queryLen,
                            );
                            const response = this.readResponse(packedPtr);
                            this.checkResponse(response);

                            const buffer = this.readArrowBuffer(response);
                            this.postMessage(
                                {
                                    messageId: this.nextMessageId++,
                                    requestId: request.messageId,
                                    type: WebDBWorkerResponseType.ARROW_BUFFER,
                                    data: { buffer },
                                },
                                [buffer.buffer],
                            );
                        } finally {
                            if (queryPtr !== 0) this.module._free(queryPtr);
                        }
                        break;
                    }

                    case WebDBWorkerRequestType.QUERY_PENDING_START: {
                        const [queryPtr, queryLen] = this.copyBuffer(this.encoder.encode(request.data.query));
                        try {
                            this.module._duckdb_web_pending_query_start_buffer(
                                packedPtr,
                                request.data.connectionId,
                                queryPtr,
                                queryLen,
                                request.data.allowStreamResult,
                            );
                            const response = this.readResponse(packedPtr);
                            this.checkResponse(response);

                            const buffer = this.readArrowBuffer(response);
                            this.postMessage(
                                {
                                    messageId: this.nextMessageId++,
                                    requestId: request.messageId,
                                    type: WebDBWorkerResponseType.ARROW_BUFFER,
                                    data: { buffer },
                                },
                                [buffer.buffer],
                            );
                        } finally {
                            if (queryPtr !== 0) this.module._free(queryPtr);
                        }
                        break;
                    }

                    case WebDBWorkerRequestType.QUERY_PENDING_POLL: {
                        this.module._duckdb_web_pending_query_poll(packedPtr, request.data.connectionId, 0);
                        const response = this.readResponse(packedPtr);
                        this.checkResponse(response);

                        const buffer = this.readArrowBuffer(response);
                        this.postMessage(
                            {
                                messageId: this.nextMessageId++,
                                requestId: request.messageId,
                                type: WebDBWorkerResponseType.ARROW_BUFFER,
                                data: { buffer },
                            },
                            [buffer.buffer],
                        );
                        break;
                    }

                    case WebDBWorkerRequestType.QUERY_PENDING_CANCEL: {
                        this.module._duckdb_web_pending_query_cancel(request.data.connectionId, 0);
                        this.sendOK(request);
                        break;
                    }

                    case WebDBWorkerRequestType.QUERY_FETCH_RESULTS: {
                        this.module._duckdb_web_query_fetch_results(packedPtr, request.data.connectionId);
                        const response = this.readResponse(packedPtr);
                        this.checkResponse(response);

                        const buffer = this.readArrowBuffer(response);
                        this.postMessage(
                            {
                                messageId: this.nextMessageId++,
                                requestId: request.messageId,
                                type: WebDBWorkerResponseType.ARROW_BUFFER,
                                data: { buffer },
                            },
                            [buffer.buffer],
                        );
                        break;
                    }

                    case WebDBWorkerRequestType.PREPARED_CREATE: {
                        const [queryPtr, queryLen] = this.copyBuffer(this.encoder.encode(request.data.query));
                        try {
                            this.module._duckdb_web_prepared_create_buffer(
                                packedPtr,
                                request.data.connectionId,
                                queryPtr,
                                queryLen,
                            );
                            const response = this.readResponse(packedPtr);
                            this.checkResponse(response);

                            const statementId = response.dataOrValue;
                            this.postMessage(
                                {
                                    messageId: this.nextMessageId++,
                                    requestId: request.messageId,
                                    type: WebDBWorkerResponseType.PREPARED_STATEMENT_ID,
                                    data: { statementId },
                                },
                                [],
                            );
                        } finally {
                            if (queryPtr !== 0) this.module._free(queryPtr);
                        }
                        break;
                    }

                    case WebDBWorkerRequestType.PREPARED_RUN: {
                        const params = request.data.params ? JSON.stringify(request.data.params) : '{}';
                        const [paramsPtr, paramsLen] = this.copyString(params);
                        try {
                            this.module._duckdb_web_prepared_run(
                                packedPtr,
                                request.data.connectionId,
                                request.data.statementId,
                                paramsPtr,
                            );
                            const response = this.readResponse(packedPtr);
                            this.checkResponse(response);

                            const buffer = this.readArrowBuffer(response);
                            this.postMessage(
                                {
                                    messageId: this.nextMessageId++,
                                    requestId: request.messageId,
                                    type: WebDBWorkerResponseType.ARROW_BUFFER,
                                    data: { buffer },
                                },
                                [buffer.buffer],
                            );
                        } finally {
                            if (paramsPtr !== 0) this.module._free(paramsPtr);
                        }
                        break;
                    }

                    case WebDBWorkerRequestType.PREPARED_SEND: {
                        const params = request.data.params ? JSON.stringify(request.data.params) : '{}';
                        const [paramsPtr, paramsLen] = this.copyString(params);
                        try {
                            this.module._duckdb_web_prepared_send(
                                packedPtr,
                                request.data.connectionId,
                                request.data.statementId,
                                paramsPtr,
                            );
                            const response = this.readResponse(packedPtr);
                            this.checkResponse(response);

                            const buffer = this.readArrowBuffer(response);
                            this.postMessage(
                                {
                                    messageId: this.nextMessageId++,
                                    requestId: request.messageId,
                                    type: WebDBWorkerResponseType.ARROW_BUFFER,
                                    data: { buffer },
                                },
                                [buffer.buffer],
                            );
                        } finally {
                            if (paramsPtr !== 0) this.module._free(paramsPtr);
                        }
                        break;
                    }

                    case WebDBWorkerRequestType.PREPARED_CLOSE: {
                        this.module._duckdb_web_prepared_close(
                            packedPtr,
                            request.data.connectionId,
                            request.data.statementId,
                        );
                        const response = this.readResponse(packedPtr);
                        this.checkResponse(response);
                        this.sendOK(request);
                        break;
                    }

                    case WebDBWorkerRequestType.INSERT_ARROW_IPC: {
                        const options = JSON.stringify(request.data.options);
                        const [optionsPtr, optionsLen] = this.copyString(options);
                        const [bufferPtr, bufferLen] = this.copyBuffer(request.data.buffer);
                        try {
                            this.module._duckdb_web_insert_arrow_from_ipc_stream(
                                packedPtr,
                                request.data.connectionId,
                                bufferPtr,
                                bufferLen,
                                optionsPtr,
                            );
                            const response = this.readResponse(packedPtr);
                            this.checkResponse(response);
                            this.sendOK(request);
                        } finally {
                            if (optionsPtr !== 0) this.module._free(optionsPtr);
                            if (bufferPtr !== 0) this.module._free(bufferPtr);
                        }
                        break;
                    }

                    default: {
                        const unknownType = (request as any).type;
                        this.failWith(request, new Error(`unknown request type ${unknownType}`));
                        break;
                    }
                }
            } finally {
                this.module._free(packedPtr);
            }
        } catch (e: any) {
            this.failWith(request, e);
        }
    }

    static register(): void {
        const worker = new DuckDBWorker(globalThis as WorkerGlobalsLike);
        globalThis.onmessage = async (event: MessageEvent<WebDBWorkerRequestVariant>) => {
            worker.onMessage(event.data);
        };
    }
}
