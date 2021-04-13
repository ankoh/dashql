// Copyright (c) 2020 The DashQL Authors

import { DuckDBModule } from './duckdb_module';
import { Logger } from '../log';
import { DuckDBConnection } from './connection';
import { StatusCode } from '../status';
import { DuckDBRuntime } from './runtime_base';

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
    /** Backend-dependent native-glue code for DuckDB */
    protected _runtime: DuckDBRuntime;

    constructor(logger: Logger, runtime: DuckDBRuntime) {
        this._logger = logger;
        this._runtime = runtime;
        this._runtime.bindings = this;
    }

    /** Get the logger */
    public get logger() {
        return this._logger;
    }
    /** Get the instance */
    public get instance() {
        return this._instance;
    }

    /// Instantiate the module
    protected abstract instantiate(moduleOverrides: Partial<DuckDBModule>): Promise<DuckDBModule>;

    /// Add file path
    public addFilePath(url: string, path: string): number {
        return this._runtime.duckdb_web_add_file_path(url, path);
    }
    /// Add file blob
    public addFileBlob(url: string, data: any): number {
        return this._runtime.duckdb_web_add_file_blob(url, data);
    }
    /// Add file buffer
    public addFileBuffer(url: string, buffer: Uint8Array): number {
        return this._runtime.duckdb_web_add_file_buffer(url, buffer);
    }
    /// Get the file object URL
    public getFileObjectURL(fileId: number): string | null {
        return this._runtime.duckdb_web_get_file_object_url(fileId);
    }
    /// Get the file buffer
    public getFileBuffer(fileId: number): Uint8Array | null {
        return this._runtime.duckdb_web_get_file_buffer(fileId);
    }

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
        let status = instance.HEAPF64[(response >> 3) + 0];
        let data = instance.HEAPF64[(response >> 3) + 1];
        let dataSize = instance.HEAPF64[(response >> 3) + 2];

        // Restore the stack
        instance.stackRestore(stackPointer);
        return [status, data, dataSize];
    }

    /** Delete response buffers */
    public dropResponseBuffers() {
        this.instance!.ccall('duckdb_web_clear_response', null, [], []);
    }

    /** Decode a string */
    public readString(begin: number, length: number): string {
        const buffer = this.instance!.HEAPU8.subarray(begin, begin + length);
        let result = '';
        for (let i = 0; i < buffer.length; i++) {
            result += String.fromCharCode(buffer[i]);
        }
        return result;
    }

    /** Copy a Uint8Array */
    public copyBuffer(begin: number, length: number): Uint8Array {
        const buffer = this.instance!.HEAPU8.subarray(begin, begin + length);
        const copy = new Uint8Array(new ArrayBuffer(buffer.byteLength));
        copy.set(buffer);
        return copy;
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
    public runQuery(conn: number, text: string): Uint8Array {
        const instance = this.instance!;
        const [s, d, n] = this.callSRet('duckdb_web_query_run', ['number', 'string'], [conn, text]);
        if (s !== StatusCode.SUCCESS) {
            throw new Error(this.readString(d, n));
        }
        const res = this.copyBuffer(d, n);
        this.dropResponseBuffers();
        return res;
    }

    /** Send a query asynchronously. Results have to be fetched with `fetchQueryResults` */
    public sendQuery(conn: number, text: string): Uint8Array {
        const instance = this.instance!;
        const [s, d, n] = this.callSRet('duckdb_web_query_send', ['number', 'string'], [conn, text]);
        if (s !== StatusCode.SUCCESS) {
            throw new Error(this.readString(d, n));
        }
        const res = this.copyBuffer(d, n);
        this.dropResponseBuffers();
        return res;
    }

    /** Fetch query results */
    public fetchQueryResults(conn: number): Uint8Array {
        const instance = this.instance!;
        const [s, d, n] = this.callSRet('duckdb_web_query_fetch_results', ['number'], [conn]);
        if (s !== StatusCode.SUCCESS) {
            throw new Error(this.readString(d, n));
        }
        const res = this.copyBuffer(d, n);
        this.dropResponseBuffers();
        return res;
    }

    /// Import csv from a given URL
    public importCSV(conn: number, filePath: string, schemaName: string, tableName: string): void {
        let instance = this.instance!;
        let [s, d, n] = this.callSRet(
            'duckdb_web_csv_import',
            ['number', 'string', 'string', 'string'],
            [conn, filePath, schemaName, tableName],
        );
        if (s !== StatusCode.SUCCESS) {
            throw new Error(this.readString(d, n));
        }
    }
}
