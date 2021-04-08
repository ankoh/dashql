// Copyright (c) 2020 The DashQL Authors

import * as arrow from 'apache-arrow';

interface IDuckDBBindings {
    disconnect(conn: number): void;
    runQuery(conn: number, text: string): Uint8Array;
    sendQuery(conn: number, text: string): void;
    fetchQueryResults(conn: number): Uint8Array;
    importCSV(conn: number, filePath: string, schemaName: string, tableName: string): void;
}

/** A result stream iterator */
class ResultStreamIterator implements Iterable<Uint8Array> {
    /** Reached end of stream? */
    _eos: boolean;

    _n: number;

    constructor(protected bindings: IDuckDBBindings, protected conn: number) {
        this._eos = false;
        this._n = 0;
    }

    next(): IteratorResult<Uint8Array> {
        if (this._eos) {
            return { done: true, value: null };
        }
        const bufferI8 = this.bindings.fetchQueryResults(this.conn);
        debugger;
        const bufferI32 = new Int32Array(bufferI8.buffer);
        const isEOS = bufferI32.length == 0 || (bufferI32.length == 2 && bufferI32[0] == -1 && bufferI32[1] == 0);
        if (isEOS) {
            this._eos = true;
            return { done: true, value: null };
        }
        return {
            done: false,
            value: bufferI8,
        };
    }

    [Symbol.iterator]() {
        return this;
    }
}

/** A thin helper to bind the connection id and talk record batches */
export class DuckDBConnection {
    /** The bindings */
    _bindings: IDuckDBBindings;
    /** The connection handle */
    _conn: number;

    /** Constructor */
    constructor(bindings: IDuckDBBindings, conn: number) {
        this._bindings = bindings;
        this._conn = conn;
    }

    public get handle() {
        return this._conn;
    }

    public disconnect(): void {
        this._bindings.disconnect(this._conn);
    }

    public runQuery<T extends { [key: string]: arrow.DataType } = any>(text: string): arrow.RecordBatchFileReader<T> {
        const buffer = this._bindings.runQuery(this._conn, text);
        const reader = arrow.RecordBatchReader.from<T>(buffer);
        console.assert(reader.isSync());
        console.assert(reader.isFile());
        return reader as arrow.RecordBatchFileReader;
    }

    public sendQuery<T extends { [key: string]: arrow.DataType } = any>(
        text: string,
    ): arrow.RecordBatchStreamReader<T> {
        const header = this._bindings.sendQuery(this._conn, text);
        const iter = new ResultStreamIterator(this._bindings, this._conn);
        console.log('from start');
        const reader = arrow.RecordBatchReader.from<T>(iter);
        console.log('from end');
        console.log(reader);
        console.assert(reader.isSync());
        console.assert(reader.isStream());
        console.log(reader);
        return reader as arrow.RecordBatchStreamReader;
    }

    public importCSV(filePath: string, schemaName: string, tableName: string): void {
        this._bindings.importCSV(this._conn, filePath, schemaName, tableName);
    }
}
