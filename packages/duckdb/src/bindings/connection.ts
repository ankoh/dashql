// Copyright (c) 2020 The DashQL Authors

import * as arrow from '@apache-arrow/ts';

interface IDuckDBBindings {
    disconnect(conn: number): void;
    runQuery(conn: number, text: string): Uint8Array;
    sendQuery(conn: number, text: string): Uint8Array;
    fetchQueryResults(conn: number): Uint8Array;
    importCSV(conn: number, filePath: string, schemaName: string, tableName: string): void;
}

/** A result stream iterator */
class ResultStreamIterator implements Iterable<Uint8Array> {
    /** The schema */
    _schema: Uint8Array;
    /** Started reading from the stream? */
    _started: boolean;
    /** Reached end of stream? */
    _eos: boolean;

    constructor(protected bindings: IDuckDBBindings, protected conn: number, protected schema: Uint8Array) {
        this._schema = schema;
        this._started = false;
        this._eos = false;
    }

    next(): IteratorResult<Uint8Array> {
        if (!this._started) {
            this._started = true;
            return { done: false, value: this._schema };
        }
        if (this._eos) {
            return { done: true, value: null };
        }
        const buffer = this.bindings.fetchQueryResults(this.conn);
        if (buffer.length == 0) {
            this._eos = true;
            return { done: true, value: null };
        }
        return {
            value: buffer,
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
        return new arrow.RecordBatchFileReader(reader);
    }

    public sendQuery<T extends { [key: string]: arrow.DataType } = any>(
        text: string,
    ): arrow.RecordBatchStreamReader<T> {
        const header = this._bindings.sendQuery(this._conn, text);
        const iter = new ResultStreamIterator(this._bindings, this._conn, header);
        const reader = arrow.RecordBatchReader.from<T>(iter);
        console.assert(reader.isSync());
        console.assert(reader.isStream());
        return new arrow.RecordBatchStreamReader(reader);
    }

    public importCSV(filePath: string, schemaName: string, tableName: string): void {
        this._bindings.importCSV(this._conn, filePath, schemaName, tableName);
    }
}
