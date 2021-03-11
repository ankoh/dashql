// Copyright (c) 2020 The DashQL Authors

import { WebDBModule } from './webdb_module';
import { webdb as proto } from '@dashql/proto';
import { flatbuffers } from 'flatbuffers';
import { Logger } from './log';
import { QueryRunOptions } from './query_options';

export interface WebDBRuntime {
    bindings?: WebDBBindings;
    dashql_blob_stream_underflow(blobId: number, buf: number, size: number): number;
}

export var DefaultWebDBRuntime: WebDBRuntime = {
    bindings: undefined,
    dashql_blob_stream_underflow: function (blobId: number, buf: number, size: number) {
        throw Error('undefined');
    },
};

/// Decode a string
function decodeString(buffer: Uint8Array): string {
    var result = '';
    for (var i = 0; i < buffer.length; i++) {
        result += String.fromCharCode(buffer[i]);
    }
    return result;
}

/// Copy a flatbuffer
function copyFlatbuffer(buffer: Uint8Array): flatbuffers.ByteBuffer {
    var copy = new Uint8Array(new ArrayBuffer(buffer.byteLength));
    copy.set(buffer);
    return new flatbuffers.ByteBuffer(copy);
}

export interface BlobStream {
    buffer: Uint8Array;
    position: number;
}

// As a global function because when passing the object to the webworker it turns into a POJO
export function copyBlobStreamTo(blobStream: BlobStream, dest: Uint8Array, pos: number, length: number): number {
    if (blobStream.position >= blobStream.buffer.length) return 0;
    let size = Math.min(length, blobStream.buffer.length - blobStream.position);
    dest.set(blobStream.buffer.slice(blobStream.position, blobStream.position + size), pos);
    blobStream.position += size;
    return size;
}

/// The proxy for either the browser- order node-based WebDB API
export abstract class WebDBBindings {
    /// The logger
    private _logger: Logger;
    /// The instance
    private _instance: WebDBModule | null = null;
    /// The loading promise
    private _openPromise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private _openPromiseResolver: () => void = () => {};
    /// The blob "file-handle" map of currently open blob streams
    private _blobMap = new Map<number, BlobStream>();

    constructor(logger: Logger) {
        this._logger = logger;
    }

    /// Get the logger
    public get logger() {
        return this._logger;
    }
    /// Get the instance
    public get instance() {
        return this._instance;
    }

    /// Instantiate the module
    protected abstract instantiate(moduleOverrides: Partial<WebDBModule>): Promise<WebDBModule>;

    /// Open the database
    public async open() {
        // Already opened?
        if (this._instance != null) {
            return;
        }
        // Open in progress?
        if (this._openPromise != null) {
            await this._openPromise;
        }

        // Create a promise that we can await
        this._openPromise = new Promise(resolve => {
            this._openPromiseResolver = resolve;
        });

        // Initialize webdb
        this._instance = await this.instantiate({
            print: console.log.bind(console),
            printErr: console.log.bind(console),
            onRuntimeInitialized: this._openPromiseResolver,
        });

        // Wait for onRuntimeInitialized
        await this._openPromise;
        this._openPromise = null;
    }

    // Call a core function with packed response buffer
    public callSRet(funcName: string, argTypes: Array<Emscripten.JSType>, args: Array<any>): [number, number, number] {
        // Save the stack
        let instance = this._instance!;
        let stackPointer = instance.stackSave();

        // Allocate the packed response buffer
        let response = instance.stackAlloc(3 * 8);
        argTypes.unshift('number');
        args.unshift(response);

        // Do the call
        instance.ccall(funcName, null, argTypes, args);

        // Read the response
        // XXX: wasm64 will break here.
        let status = instance.HEAPU32[(response >> 2) + 0];
        let data = instance.HEAPU32[(response >> 2) + 2];
        let dataSize = instance.HEAPU32[(response >> 2) + 4];

        // Restore the stack
        instance.stackRestore(stackPointer);
        return [status, data, dataSize];
    }

    /// Connect to database
    public connect(): WebDBConnection {
        let instance = this._instance!;
        let conn = instance.ccall('dashql_webdb_connect', 'number', [], []);
        return new WebDBConnection(this, conn);
    }

    /// Disconnect from database
    public disconnect(conn: number): void {
        this.instance!.ccall('dashql_webdb_disconnect', null, ['number'], [conn]);
    }

    /// Encode query arguments
    protected encodeQueryArguments(text: string, options: QueryRunOptions = {}): number {
        const instance = this.instance!;
        const builder = new flatbuffers.Builder();
        const partitionBoundaries = proto.QueryArguments.createPartitionBoundariesVector(
            builder,
            options.partitionBoundaries || [],
        );
        const scriptOfs = builder.createString(text);
        proto.QueryArguments.start(builder);
        proto.QueryArguments.addScript(builder, scriptOfs);
        proto.QueryArguments.addPartitionBoundaries(builder, partitionBoundaries);
        const args = proto.QueryArguments.end(builder);
        builder.finish(args);
        const argsBuffer = builder.dataBuffer();

        // Copy the arguments into the wasm module
        const argsMem = argsBuffer.bytes().subarray(argsBuffer.position());
        const argsPtr = instance.stackAlloc(argsMem.length);
        instance.HEAPU8.set(argsMem, argsPtr);
        return argsPtr;
    }

    /// Send a query and return the full result
    public runQuery(conn: number, text: string, options: QueryRunOptions = {}): proto.QueryResult {
        const instance = this.instance!;
        const args = this.encodeQueryArguments(text, options);
        const [s, d, n] = this.callSRet('dashql_webdb_run_query', ['number', 'number'], [conn, args]);
        const mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        const res = proto.QueryResult.getRoot(copyFlatbuffer(mem));
        instance.ccall('dashql_clear_response', null, [], []);
        return res;
    }

    /// Send a query and return a result stream
    public sendQuery(conn: number, text: string, options: QueryRunOptions = {}): proto.QueryResult {
        const instance = this.instance!;
        const args = this.encodeQueryArguments(text, options);
        const [s, d, n] = this.callSRet('dashql_webdb_send_query', ['number', 'number'], [conn, args]);
        const mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        const res = proto.QueryResult.getRoot(copyFlatbuffer(mem));
        instance.ccall('dashql_clear_response', null, [], []);
        return res;
    }

    /// Fetch query results
    public fetchQueryResults(conn: number): proto.QueryResultChunk {
        let instance = this.instance!;
        let [s, d, n] = this.callSRet('dashql_webdb_fetch_query_results', ['number'], [conn]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        let res = proto.QueryResultChunk.getRoot(copyFlatbuffer(mem));
        instance.ccall('dashql_clear_response', null, [], []);
        return res;
    }

    /// Analyze a query
    public analyzeQuery(conn: number, _text: string): proto.QueryPlan {
        let instance = this.instance!;
        let [s, d, n] = this.callSRet('dashql_webdb_analyze_query', ['number'], [conn]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        let plan = proto.QueryPlan.getRoot(copyFlatbuffer(mem));
        instance.ccall('dashql_clear_response', null, [], []);
        return plan;
    }

    /// Ingest a blob
    public ingestBlobStream(blobStream: BlobStream): void {
        const blobId = this._blobMap.size;
        this._blobMap.set(blobId, blobStream);

        this.instance!.ccall('dashql_blob_stream_consume', null, ['number'], [blobId]);

        this._blobMap.delete(blobId);
    }

    public getBlobStreamById(blobId: number): BlobStream | undefined {
        return this._blobMap.get(blobId);
    }
}

/// A thin helper to memoize the connection id
export class WebDBConnection {
    /// The bindings
    _bindings: WebDBBindings;
    /// The connection handle
    _conn: number;

    /// Constructor
    constructor(bindings: WebDBBindings, conn: number) {
        this._bindings = bindings;
        this._conn = conn;
    }

    public get handle() {
        return this._conn;
    }

    public disconnect(): void {
        this._bindings.disconnect(this._conn);
    }

    public runQuery(text: string, options: QueryRunOptions = {}): proto.QueryResult {
        return this._bindings.runQuery(this._conn, text, options);
    }

    public sendQuery(text: string, options: QueryRunOptions = {}): proto.QueryResult {
        return this._bindings.sendQuery(this._conn, text, options);
    }

    public fetchQueryResults(): proto.QueryResultChunk {
        return this._bindings.fetchQueryResults(this._conn);
    }

    public analyzeQuery(_text: string): proto.QueryPlan {
        return this._bindings.analyzeQuery(this._conn, _text);
    }
}
