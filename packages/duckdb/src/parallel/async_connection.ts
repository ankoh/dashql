// Copyright (c) 2020 The DashQL Authors

import { Logger, LogLevel, LogTopic, LogOrigin, LogEvent } from '../log';
import * as arrow from 'apache-arrow';

interface IAsyncDuckDB {
    logger: Logger;

    disconnect(conn: number): Promise<null>;
    runQuery(conn: number, text: string): Promise<Uint8Array>;
    sendQuery(conn: number, text: string): Promise<null>;
    fetchQueryResults(conn: number): Promise<Uint8Array>;
    importCSV(conn: number, filePath: string, schemaName: string, tableName: string): Promise<null>;
}

/** An async result stream iterator */
class ResultStreamIterator implements AsyncIterable<Uint8Array> {
    /** Reached end of stream? */
    _eos: boolean;

    constructor(protected db: IAsyncDuckDB, protected conn: number) {
        this._eos = false;
    }

    async next(): Promise<IteratorResult<Uint8Array>> {
        if (this._eos) {
            return { done: true, value: null };
        }
        const bufferI8 = await this.db.fetchQueryResults(this.conn);
        const bufferI32 = new Int32Array(bufferI8.buffer);
        const isEOS = bufferI32.length == 0 || (bufferI32.length == 2 && bufferI32[0] == -1 && bufferI32[1] == 0);
        if (isEOS) {
            this._eos = true;
            return { done: true, value: null };
        }
        return {
            value: bufferI8,
        };
    }

    [Symbol.asyncIterator]() {
        return this;
    }
}

/** An async connection. */
/** This interface will enable us to swap duckdb with a native version. */
export interface AsyncConnection {
    /** Disconnect from the database */
    disconnect(): Promise<null>;
    /** Run a query */
    runQuery<T extends { [key: string]: arrow.DataType } = any>(text: string): Promise<arrow.RecordBatchFileReader<T>>;
    /** Send a query */
    sendQuery<T extends { [key: string]: arrow.DataType } = any>(
        text: string,
    ): Promise<arrow.AsyncRecordBatchStreamReader<T>>;
}

/** A thin helper to memoize the connection id */
export class AsyncDuckDBConnection implements AsyncConnection {
    /** The async duckdb */
    _instance: IAsyncDuckDB;
    /** The conn handle */
    _conn: number;

    constructor(instance: IAsyncDuckDB, conn: number) {
        this._instance = instance;
        this._conn = conn;
    }

    /** Disconnect from the database */
    public async disconnect(): Promise<null> {
        return this._instance.disconnect(this._conn);
    }

    /** Run a query */
    public async runQuery<T extends { [key: string]: arrow.DataType } = any>(
        text: string,
    ): Promise<arrow.RecordBatchFileReader<T>> {
        this._instance.logger.log({
            timestamp: new Date(),
            level: LogLevel.INFO,
            origin: LogOrigin.ASYNC_WEBDB,
            topic: LogTopic.QUERY,
            event: LogEvent.RUN,
            value: text,
        });
        const buffer = await this._instance.runQuery(this._conn, text);
        const reader = arrow.RecordBatchReader.from<T>(buffer);
        console.assert(reader.isSync());
        console.assert(reader.isFile());
        return reader as arrow.RecordBatchFileReader;
    }

    /** Send a query */
    public async sendQuery<T extends { [key: string]: arrow.DataType } = any>(
        text: string,
    ): Promise<arrow.AsyncRecordBatchStreamReader<T>> {
        this._instance.logger.log({
            timestamp: new Date(),
            level: LogLevel.INFO,
            origin: LogOrigin.ASYNC_WEBDB,
            topic: LogTopic.QUERY,
            event: LogEvent.RUN,
            value: text,
        });
        const header = await this._instance.sendQuery(this._conn, text);
        const iter = new ResultStreamIterator(this._instance, this._conn);
        const reader = arrow.RecordBatchReader.from<T>(iter);
        console.assert(reader.isAsync());
        console.assert(reader.isStream());
        return (reader as unknown) as arrow.AsyncRecordBatchStreamReader<T>; // XXX
    }

    /// Import csv from a given URL
    public async importCSV(filePath: string, schemaName: string, tableName: string) {
        return await this._instance.importCSV(this._conn, filePath, schemaName, tableName);
    }
}
