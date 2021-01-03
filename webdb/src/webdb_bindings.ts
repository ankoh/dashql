// Copyright (c) 2020 The DashQL Authors

import { WebDBModule } from './webdb_module';
import { QueryResultBuffer, QueryResultChunkBuffer, QueryPlanBuffer } from './webdb_buffer';
import { webdb as proto } from '@dashql/proto';

export interface WebDBRuntime {}

/// Decode a string
function decodeString(buffer: Uint8Array): string {
    var result = "";
    for (var i = 0; i < buffer.length; i++) {
        result += String.fromCharCode(buffer[i]);
    }
    return result;
}

/// A connection to WebDB
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

    /// Disconnect from database
    public disconnect(): void {
        let instance = this._bindings.instance!;
        instance.ccall('dashql_webdb_disconnect', null, ['number'], [this._conn]);
    }

    /// Send a query and return the full result
    public runQuery(text: string): QueryResultBuffer {
        let instance = this._bindings.instance!;
        let [s, d, n] = this._bindings.callSRet('dashql_webdb_run_query', ['number', 'string'], [this._conn, text]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        let msg = new QueryResultBuffer(mem);
        instance.ccall('dashql_clear_response', null, [], []);
        return msg;
    }

    /// Send a query and return a result stream
    public sendQuery(text: string): QueryResultBuffer {
        let instance = this._bindings.instance!;
        let [s, d, n] = this._bindings.callSRet('dashql_webdb_send_query', ['number', 'string'], [this._conn, text]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        let msg = new QueryResultBuffer(mem);
        instance.ccall('dashql_clear_response', null, [], []);
        return msg;
    }

    /// Fetch query results
    public fetchQueryResults(): QueryResultChunkBuffer {
        let instance = this._bindings.instance!;
        let [s, d, n] = this._bindings.callSRet('dashql_webdb_fetch_query_results', ['number'], [this._conn]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        let msg = new QueryResultChunkBuffer(mem);
        instance.ccall('dashql_clear_response', null, [], []);
        return msg;
    }

    /// Analyze a query
    public async analyzeQuery(text: string): Promise<QueryPlanBuffer> {
        let instance = this._bindings.instance!;
        let [s, d, n] = this._bindings.callSRet('dashql_webdb_analyze_query', ['number'], [this._conn]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        let msg = new QueryPlanBuffer(mem);
        instance.ccall('dashql_clear_response', null, [], []);
        return msg;
    }
}

/// The proxy for either the browser- order node-based WebDB API
export abstract class WebDBBindings {
    /// The instance
    private _instance: WebDBModule | null = null;
    /// The loading promise
    private _openPromise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private _openPromiseResolver: () => void = () => { };

    /// Get the instance
    public get instance() { return this._instance; }

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
    public callSRet(
        funcName: string,
        argTypes: Array<Emscripten.JSType>,
        args: Array<any>,
    ): [number, number, number] {
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
};
