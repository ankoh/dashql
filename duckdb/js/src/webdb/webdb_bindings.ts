// Copyright (c) 2020 The DashQL Authors

import { DuckDBModule } from '../wasm/duckdb_module';
import { QueryResultBuffer, QueryResultChunkBuffer, QueryPlanBuffer } from './webdb_buffer';
import * as proto from '../proto';

/// Decode a string
function decodeString(buffer: Uint8Array): string {
    var result = "";
    for (var i = 0; i < buffer.length; i++) {
        result += String.fromCharCode(buffer[i]);
    }
    return result;
}

const SUCCESS = 0

/// A connection to DuckDB
export class DuckDBConnection {
    /// The bindings
    _bindings: DuckDBBindings;
    /// The connection handle
    _conn: number;

    /// Constructor
    constructor(bindings: DuckDBBindings, conn: number) {
        this._bindings = bindings;
        this._conn = conn;
    }

    /// Disconnect from database
    public async disconnect(): Promise<void> {
        let instance = await this._bindings.getInstance();
        instance.ccall('duckdb_web_disconnect', null, ['number'], [this._conn]);
    }

    /// Send a query and return the full result
    public async runQuery(text: string): Promise<QueryResultBuffer> {
        let instance = await this._bindings.getInstance();
        let [s, d, n] = await this._bindings.callSRet('duckdb_web_run_query', ['number', 'string'], [this._conn, text]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== SUCCESS) {
            throw new Error(decodeString(mem));
        }
        let msg = new QueryResultBuffer(mem);
        instance.ccall('duckdb_web_clear_response', null, [], []);
        return msg;
    }

    /// Send a query and return a result stream
    public async sendQuery(text: string): Promise<QueryResultBuffer> {
        let instance = await this._bindings.getInstance();
        let [s, d, n] = await this._bindings.callSRet('duckdb_web_send_query', ['number', 'string'], [this._conn, text]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== SUCCESS) {
            throw new Error(decodeString(mem));
        }
        let msg = new QueryResultBuffer(mem);
        instance.ccall('duckdb_web_clear_response', null, [], []);
        return msg;
    }

    /// Fetch query results
    public async fetchQueryResults(): Promise<QueryResultChunkBuffer> {
        let instance = await this._bindings.getInstance();
        let [s, d, n] = await this._bindings.callSRet('duckdb_web_fetch_query_results', ['number'], [this._conn]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== SUCCESS) {
            throw new Error(decodeString(mem));
        }
        let msg = new QueryResultChunkBuffer(mem);
        instance.ccall('duckdb_web_clear_response', null, [], []);
        return msg;
    }

    /// Analyze a query
    public async analyzeQuery(text: string): Promise<QueryPlanBuffer> {
        let instance = await this._bindings.getInstance();
        let [s, d, n] = await this._bindings.callSRet('duckdb_web_analyze_query', ['number'], [this._conn]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== SUCCESS) {
            throw new Error(decodeString(mem));
        }
        let msg = new QueryPlanBuffer(mem);
        instance.ccall('duckdb_web_clear_response', null, [], []);
        return msg;
    }
}

/// The proxy for either the browser- order node-based DuckDB API
export abstract class DuckDBBindings {
    /// The instance
    private _instance: DuckDBModule | null = null;
    /// The loading promise
    private _openPromise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private _openPromiseResolver: () => void = () => { };

    /// Instantiate the module
    protected abstract instantiate(moduleOverrides: Partial<DuckDBModule>): Promise<DuckDBModule>;

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

        // Initialize duckdb
        this._instance = await this.instantiate({
            print: console.log.bind(console),
            printErr: console.log.bind(console),
            onRuntimeInitialized: this._openPromiseResolver,
        });

        // Wait for onRuntimeInitialized
        await this._openPromise;
        this._openPromise = null;
    }

    /// Get the instance
    public async getInstance(): Promise<DuckDBModule> {
        if (this._instance != null)
            return this._instance;
        if (this._openPromise != null) {
            await this._openPromise;
            if (this._instance == null)
                throw new Error('instance initialization failed');
            return this._instance;
        }
        throw new Error('instance not initialized');
    }

    // Call a core function with packed response buffer
    public async callSRet(
        funcName: string,
        argTypes: Array<Emscripten.JSType>,
        args: Array<any>,
    ): Promise<[number, number, number]> {
        // Save the stack
        let instance = await this.getInstance();
        let stackPointer = instance.stackSave();

        // Allocate the packed response buffer
        let response = instance.allocate(3 * 8, 'i8', instance.ALLOC_STACK);
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
    public async connect(): Promise<DuckDBConnection> {
        let instance = await this.getInstance();
        let conn = instance.ccall('duckdb_web_connect', 'number', [], []);
        return new DuckDBConnection(this, conn);
    }
};
