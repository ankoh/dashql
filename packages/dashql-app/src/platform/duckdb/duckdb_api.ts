import * as arrow from 'apache-arrow';

export interface DuckDBOpenOptions {
    path?: string;
    maximumThreads?: number;
    query?: {
        queryPollingInterval?: number;
        castBigIntToDouble?: boolean;
        castTimestampToDate?: boolean;
        castDurationToTime64?: boolean;
        castDecimalToDouble?: boolean;
    };
}

export interface DuckDBInsertOptions {
    schema?: string;
    name: string;
    create?: boolean;
}

// Backward-compatible aliases while consumers migrate away from the old web-specific names.
export type WebDBOpenOptions = DuckDBOpenOptions;
export type WebDBInsertOptions = DuckDBInsertOptions;

export function decodeArrowTable(buffer: Uint8Array): arrow.Table {
    const reader = arrow.RecordBatchReader.from(buffer);
    return new arrow.Table(reader);
}

export function encodeArrowTable(table: arrow.Table): Uint8Array {
    return arrow.tableToIPC(table, 'stream');
}

export abstract class DuckDB {
    public abstract detach(): void;
    public abstract terminate(): void;
    public abstract ping(): Promise<void>;
    public abstract open(options?: DuckDBOpenOptions): Promise<void>;
    public abstract reset(): Promise<void>;
    public abstract getVersion(): Promise<string>;
    public abstract connect(): Promise<DuckDBConnection>;
}

export abstract class DuckDBConnection {
    protected closed = false;

    protected checkClosed(): void {
        if (this.closed) {
            throw new Error('Connection is closed');
        }
    }

    public async close(): Promise<void> {
        if (this.closed) {
            return;
        }
        this.closed = true;
        await this.closeImpl();
    }

    public async query(query: string): Promise<arrow.Table> {
        this.checkClosed();
        return await this.queryImpl(query);
    }

    public async queryPending(query: string, allowStreamResult: boolean = false): Promise<arrow.Table> {
        this.checkClosed();
        return await this.queryPendingImpl(query, allowStreamResult);
    }

    public async pollPending(): Promise<arrow.Table> {
        this.checkClosed();
        return await this.pollPendingImpl();
    }

    public async cancelPending(): Promise<void> {
        this.checkClosed();
        await this.cancelPendingImpl();
    }

    public async fetchResults(): Promise<arrow.Table> {
        this.checkClosed();
        return await this.fetchResultsImpl();
    }

    public async prepare(query: string): Promise<DuckDBPreparedStatement> {
        this.checkClosed();
        return await this.prepareImpl(query);
    }

    public async insertArrowIPC(buffer: Uint8Array, options: DuckDBInsertOptions): Promise<void> {
        this.checkClosed();
        await this.insertArrowIPCImpl(buffer, options);
    }

    public async insertArrowTable(table: arrow.Table, options: DuckDBInsertOptions): Promise<void> {
        this.checkClosed();
        await this.insertArrowIPCImpl(encodeArrowTable(table), options);
    }

    protected abstract closeImpl(): Promise<void>;
    protected abstract queryImpl(query: string): Promise<arrow.Table>;
    protected abstract queryPendingImpl(query: string, allowStreamResult: boolean): Promise<arrow.Table>;
    protected abstract pollPendingImpl(): Promise<arrow.Table>;
    protected abstract cancelPendingImpl(): Promise<void>;
    protected abstract fetchResultsImpl(): Promise<arrow.Table>;
    protected abstract prepareImpl(query: string): Promise<DuckDBPreparedStatement>;
    protected abstract insertArrowIPCImpl(buffer: Uint8Array, options: DuckDBInsertOptions): Promise<void>;
}

export abstract class DuckDBPreparedStatement {
    protected closed = false;

    protected checkClosed(): void {
        if (this.closed) {
            throw new Error('Prepared statement is closed');
        }
    }

    public async close(): Promise<void> {
        if (this.closed) {
            return;
        }
        this.closed = true;
        await this.closeImpl();
    }

    public async run(params?: any): Promise<arrow.Table> {
        this.checkClosed();
        return await this.runImpl(params);
    }

    public async send(params?: any): Promise<arrow.Table> {
        this.checkClosed();
        return await this.sendImpl(params);
    }

    protected abstract closeImpl(): Promise<void>;
    protected abstract runImpl(params?: any): Promise<arrow.Table>;
    protected abstract sendImpl(params?: any): Promise<arrow.Table>;
}
