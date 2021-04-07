// Copyright (c) 2020 The DashQL Authors

import { DuckDBModule } from './duckdb_module';
import { duckdb as proto, fb as flatbuffers } from '@dashql/proto';
import { Logger, QueryRunOptions } from '../common';

/** Decode a string */
function decodeString(buffer: Uint8Array): string {
    let result = '';
    for (let i = 0; i < buffer.length; i++) {
        result += String.fromCharCode(buffer[i]);
    }
    return result;
}

/** Copy a Uint8Array */
function memcpy(buffer: Uint8Array): Uint8Array {
    const copy = new Uint8Array(new ArrayBuffer(buffer.byteLength));
    copy.set(buffer);
    return copy;
}

/// The proxy for either the browser- order node-based DuckDB API
export abstract class DuckDBBindings {
    /** The logger */
    private _logger: Logger;
    /** The instance */
    private _instance: DuckDBModule | null = null;
    /** The loading promise */
    private _openPromise: Promise<void> | null = null;
    /** The resolver for the open promise (called by onRuntimeInitialized) */
    private _openPromiseResolver: () => void = () => {};

    constructor(logger: Logger) {
        this._logger = logger;
    }

    /** Get the logger */
    public get logger() {
        return this._logger;
    }
    /** Get the instance */
    public get instance() {
        return this._instance;
    }

    /// Registers the given URL as a file to be possibly loaded by DuckDB.
    public abstract registerURL(url: string): Promise<void>;

    /// Open a file previously registered by the given URL. Returns the Blob ID
    public abstract openURL(url: string): number;

    /// Instantiate the module
    protected abstract instantiate(moduleOverrides: Partial<DuckDBModule>): Promise<DuckDBModule>;

    /** Open the database */
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

    /** Connect to database */
    public connect(): DuckDBConnection {
        let instance = this._instance!;
        let conn = instance.ccall('duckdb_web_connect', 'number', [], []);
        return new DuckDBConnection(this, conn);
    }

    /** Disconnect from database */
    public disconnect(conn: number): void {
        this.instance!.ccall('duckdb_web_disconnect', null, ['number'], [conn]);
    }

    /** Send a query and return the full result */
    public runQuery(conn: number, text: string, options: QueryRunOptions = {}): Uint8Array {
        const instance = this.instance!;
        const [s, d, n] = this.callSRet('duckdb_web_run_query', ['number', 'string'], [conn, text]);
        const mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        const res = memcpy(mem);
        instance.ccall('dashql_clear_response', null, [], []);
        return res;
    }

    /** Send a query asynchronously. Results have to be fetched with `fetchQueryResults` */
    public sendQuery(conn: number, text: string): void {
        const instance = this.instance!;
        const [s, d, n] = this.callSRet('duckdb_web_send_query', ['number', 'string'], [conn, text]);
        const mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        instance.ccall('dashql_clear_response', null, [], []);
    }

    /** Fetch query results */
    public fetchQueryResults(conn: number): Uint8Array {
        const instance = this.instance!;
        const [s, d, n] = this.callSRet('duckdb_web_fetch_query_results', ['number'], [conn]);
        const mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        const res = memcpy(mem);
        instance.ccall('dashql_clear_response', null, [], []);
        return res;
    }

    /// Import csv from a given URL
    public importCSV(conn: number, filePath: string, schemaName: string, tableName: string): void {
        let instance = this.instance!;
        let [s, d, n] = this.callSRet(
            'duckdb_web_import_csv',
            ['number', 'string', 'string', 'string'],
            [conn, filePath, schemaName, tableName],
        );

        let mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
    }
}

/** A thin helper to memoize the connection id */
export class DuckDBConnection {
    /** The bindings */
    _bindings: DuckDBBindings;
    /** The connection handle */
    _conn: number;

    /** Constructor */
    constructor(bindings: DuckDBBindings, conn: number) {
        this._bindings = bindings;
        this._conn = conn;
    }

    public get handle() {
        return this._conn;
    }

    public disconnect(): void {
        this._bindings.disconnect(this._conn);
    }

    public runQuery(text: string): Uint8Array {
        return this._bindings.runQuery(this._conn, text);
    }

    public sendQuery(text: string): void {
        return this._bindings.sendQuery(this._conn, text);
    }

    public fetchQueryResults(): Uint8Array {
        return this._bindings.fetchQueryResults(this._conn);
    }

    public importCSV(filePath: string, schemaName: string, tableName: string): void {
        this._bindings.importCSV(this._conn, filePath, schemaName, tableName);
    }
}
