// Copyright (c) 2020 The DashQL Authors

import { Logger, LogLevel, LogTopic, LogOrigin, LogEvent } from '../log';
import * as arrow from 'apache-arrow';

interface IAsyncDuckDB {
    logger: Logger;

    disconnect(conn: number): Promise<null>;
    runQuery(conn: number, text: string): Promise<Uint8Array>;
    sendQuery(conn: number, text: string): Promise<Uint8Array>;
    fetchQueryResults(conn: number): Promise<Uint8Array>;
    importCSV(conn: number, filePath: string, schemaName: string, tableName: string): Promise<null>;
}

/** An async result stream iterator */
class ResultStreamIterator implements AsyncIterable<Uint8Array> {
    /** The schema */
    _schema: Uint8Array;
    /** Started reading from the stream? */
    _started: boolean;
    /** Reached end of stream? */
    _eos: boolean;

    constructor(protected db: IAsyncDuckDB, protected conn: number, protected schema: Uint8Array) {
        this._schema = schema;
        this._started = false;
        this._eos = false;
    }

    async next(): Promise<IteratorResult<Uint8Array>> {
        if (!this._started) {
            this._started = true;
            return { done: false, value: this._schema };
        }
        if (this._eos) {
            return { done: true, value: null };
        }
        const buffer = await this.db.fetchQueryResults(this.conn);
        if (buffer.length == 0) {
            this._eos = true;
            return { done: true, value: null };
        }
        return {
            value: buffer,
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
        const iter = new ResultStreamIterator(this._instance, this._conn, header);
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
