// Copyright (c) 2020 The DashQL Authors

import { DuckDBModule } from '../duckdb/duckdb_module';
import { QueryResultBuffer, QueryResultChunkBuffer, QueryPlanBuffer } from './webapi_buffer';
import { TextDecoder } from 'text-encoding';
import * as proto from '../proto';

function buf2hex(buffer: Uint8Array) { // buffer is an ArrayBuffer
  return Array.prototype.map.call(buffer, x => ('00' + x.toString(16)).slice(-2)).join('');
}

/// The proxy for either the browser- order node-based DuckDB API
export abstract class DuckDBBindings {
    /// The instance
    private instance: DuckDBModule | null = null;
    /// The loading promise
    private openPromise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private openPromiseResolver: () => void = () => { };

    /// Instantiate the module
    protected abstract instantiate(moduleOverrides: Partial<DuckDBModule>): Promise<DuckDBModule>;

    /// Open the database
    public async open() {
        // Already opened?
        if (this.instance != null) {
            return;
        }
        // Open in progress?
        if (this.openPromise != null) {
            await this.openPromise;
        }

        // Create a promise that we can await
        this.openPromise = new Promise(resolve => {
            this.openPromiseResolver = resolve;
        });

        // Initialize duckdb
        this.instance = await this.instantiate({
            print: console.log.bind(console),
            printErr: console.log.bind(console),
            onRuntimeInitialized: this.openPromiseResolver,
        });

        // Wait for onRuntimeInitialized
        await this.openPromise;
        this.openPromise = null;
    }

    /// Get the instance
    protected async getInstance(): Promise<DuckDBModule> {
        if (this.instance != null)
            return this.instance;
        if (this.openPromise != null) {
            await this.openPromise;
            if (this.instance == null)
                throw new Error('instance initialization failed');
            return this.instance;
        }
        throw new Error('instance not initialized');
    }

    // Decode a string
    protected decodeString(buffer: Uint8Array): string {
        var result = "";
        for (var i = 0; i < buffer.length; i++) {
            result += String.fromCharCode(buffer[i]);
        }
        return result;
    }

    // Call a core function with packed response buffer
    protected async callSRet(
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
    public async connect(): Promise<number> {
        let instance = await this.getInstance();
        return instance.ccall('duckdb_webapi_connect', 'number', [], []);
    }

    /// Disconnect from database
    public async disconnect(conn: number): Promise<void> {
        let instance = await this.getInstance();
        instance.ccall('duckdb_webapi_disconnect', null, ['number'], [conn]);
    }

    /// Copy a buffer
    public async copyBuffer(conn: number, buffer: Uint8Array): Promise<[number, number]> {
        let instance = await this.getInstance();
        var ptr = instance.allocate(buffer.length, 'i8', instance.ALLOC_NORMAL);
        let mem = instance.HEAPU8.subarray(ptr, ptr + buffer.length);
        mem.set(buffer);
        instance.ccall('duckdb_webapi_register_buffer', null, ['number', 'number', 'number'], [conn, ptr, buffer.length]);
        return [ptr, buffer.length];
    }

    /// Send a query and return the full result
    public async runQuery(conn: number, text: string): Promise<QueryResultBuffer> {
        let instance = await this.getInstance();
        let [s, d, n] = await this.callSRet('duckdb_webapi_run_query', ['number', 'string'], [conn, text]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.api.StatusCode.SUCCESS) {
            throw new Error(this.decodeString(mem));
        }
        let msg = new QueryResultBuffer(mem);
        instance.ccall('duckdb_webapi_release_buffer', null, ['number', 'number'], [conn, d]);
        return msg;
    }

    /// Send a query and return a result stream
    public async sendQuery(conn: number, text: string): Promise<QueryResultBuffer> {
        let instance = await this.getInstance();
        let [s, d, n] = await this.callSRet('duckdb_webapi_send_query', ['number', 'string'], [conn, text]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.api.StatusCode.SUCCESS) {
            throw new Error(this.decodeString(mem));
        }
        let msg = new QueryResultBuffer(mem);
        instance.ccall('duckdb_webapi_release_buffer', null, ['number', 'number'], [conn, d]);
        return msg;
    }

    /// Fetch query results
    public async fetchQueryResults(conn: number): Promise<QueryResultChunkBuffer> {
        let instance = await this.getInstance();
        let [s, d, n] = await this.callSRet('duckdb_webapi_fetch_query_results', ['number'], [conn]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.api.StatusCode.SUCCESS) {
            throw new Error(this.decodeString(mem));
        }
        let msg = new QueryResultChunkBuffer(mem);
        instance.ccall('duckdb_webapi_release_buffer', null, ['number', 'number'], [conn, d]);
        return msg;
    }

    /// Analyze a query
    public async analyzeQuery(conn: number, text: string): Promise<QueryPlanBuffer> {
        let instance = await this.getInstance();
        let [s, d, n] = await this.callSRet('duckdb_webapi_analyze_query', ['number'], [conn]);
        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.api.StatusCode.SUCCESS) {
            throw new Error(this.decodeString(mem));
        }
        let msg = new QueryPlanBuffer(mem);
        instance.ccall('duckdb_webapi_release_buffer', null, ['number', 'number'], [conn, d]);
        return msg;
    }
};
