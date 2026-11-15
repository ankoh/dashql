import type * as arrow from 'apache-arrow';

import { Logger } from '../platform/logger/logger.js';
import type {
    EmbeddedClientContext,
    EmbeddedComputeDatabase,
    EmbeddedTableImportConnection,
} from '../platform/database/embedded_database.js';
import { OrderByConstraint, SQLFrame } from './sql/sqlframe_builder.js';

const LOG_CTX = "data_frame";

let nextTableId = 0;

/// The options of a read of the rows of a data frame
export interface DataFrameReadOptions {
    /// The order of the rows. A table does not keep the order of the query that created it, the order of a read
    /// without constraints is arbitrary.
    orderBy?: OrderByConstraint[];
    /// The columns to read, all columns by default
    columns?: string[];
    /// Cancels the read
    abort?: AbortSignal;
}

export function generateTableName(prefix: string = "__df"): string {
    return `${prefix}_${nextTableId++}`;
}

export class DataFrame {
    readonly database: EmbeddedComputeDatabase;
    readonly tableName: string;
    /// The client context of the queries of the data frame, the one of the query that created it
    readonly clientContext: EmbeddedClientContext | null;

    constructor(database: EmbeddedComputeDatabase, tableName: string, clientContext: EmbeddedClientContext | null = null) {
        this.database = database;
        this.tableName = tableName;
        this.clientContext = clientContext;
    }

    static async withConnection<T>(
        database: EmbeddedComputeDatabase,
        fn: (conn: EmbeddedTableImportConnection) => Promise<T>,
        clientContext?: EmbeddedClientContext | null,
    ): Promise<T> {
        const conn = await database.connect({ pooled: true, clientContext: clientContext ?? undefined });
        try {
            return await fn(conn);
        } finally {
            await conn.close();
        }
    }

    async withConnection<T>(fn: (conn: EmbeddedTableImportConnection) => Promise<T>): Promise<T> {
        return await DataFrame.withConnection(this.database, fn, this.clientContext);
    }

    static async fromArrowTable(
        database: EmbeddedComputeDatabase,
        table: arrow.Table,
        tableName: string,
        clientContext: EmbeddedClientContext | null = null,
    ): Promise<DataFrame> {
        await DataFrame.withConnection(database, async conn => {
            await conn.insertArrowTable(table, { name: tableName, create: true });
        }, clientContext);
        return new DataFrame(database, tableName, clientContext);
    }

    static async fromSQL(
        database: EmbeddedComputeDatabase,
        sql: string,
        tableName: string,
        abort?: AbortSignal,
        clientContext?: EmbeddedClientContext | null,
    ): Promise<DataFrame> {
        await DataFrame.withConnection(database, async conn => {
            await conn.createTableAs(tableName, sql, abort);
        }, clientContext);
        return new DataFrame(database, tableName, clientContext);
    }

    async readTable(options: DataFrameReadOptions = {}): Promise<arrow.Table> {
        let frame = SQLFrame.from(this.tableName);
        if (options.orderBy != null) frame = frame.orderBy(options.orderBy);
        if (options.columns != null) frame = frame.project(options.columns);
        const sql = frame.toSQL();
        return await this.withConnection(async conn => await conn.query(sql, options.abort));
    }

    async destroy(): Promise<void> {
        await this.withConnection(async conn => await conn.execute(`DROP TABLE IF EXISTS "${this.tableName}"`));
    }
}

/// The data frames of the computations that are alive.
///
/// The computation state owns the data frames that it holds (computation_native.ts): it tells the registry when it
/// takes a data frame and when it lets go of one. The host holds a data frame outside of the state while it reads it,
/// e.g. a search of the columns, with `acquire` and `release`. A data frame is dropped once neither holds it.
export class DataFrameRegistry {
    logger: Logger;
    /// The holds of the host by data frame
    private readonly hostHolds: Map<DataFrame, number> = new Map();
    /// The data frames that the computation state holds
    private readonly heldByState: Set<DataFrame> = new Set();

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /// The data frames that are alive with their holds: the holds of the host and one of the state
    public getRegisteredDataFrames(): Map<DataFrame, number> {
        const frames = new Map(this.hostHolds);
        for (const dataFrame of this.heldByState) {
            frames.set(dataFrame, (frames.get(dataFrame) ?? 0) + 1);
        }
        return frames;
    }

    /// Hold a data frame outside of the state, e.g. while a query reads it
    acquire(dataFrame: DataFrame | null | undefined, times: number = 1) {
        if (dataFrame == undefined || dataFrame == null) {
            return;
        }
        this.hostHolds.set(dataFrame, (this.hostHolds.get(dataFrame) ?? 0) + times);
    }

    /// Let go of a hold of the host, the data frame is dropped if the state doesn't hold it either
    release(dataFrame?: DataFrame | null) {
        if (dataFrame == undefined || dataFrame == null) {
            return;
        }
        const holds = this.hostHolds.get(dataFrame);
        if (holds == null) {
            this.logger.warn("Attempted to release unknown data frame", {
                "tableName": dataFrame.tableName
            }, LOG_CTX);
            return;
        }
        if (holds > 1) {
            this.hostHolds.set(dataFrame, holds - 1);
            return;
        }
        this.hostHolds.delete(dataFrame);
        if (!this.heldByState.has(dataFrame)) {
            this.destroy(dataFrame);
        }
    }

    releaseMany(dataFrames: (DataFrame | null | undefined)[]) {
        for (const dataFrame of dataFrames) {
            this.release(dataFrame);
        }
    }

    /// The computation state holds a data frame
    adoptByState(dataFrame: DataFrame) {
        this.heldByState.add(dataFrame);
    }

    /// The computation state let go of a data frame, it is dropped unless the host holds it
    releaseByState(dataFrame: DataFrame) {
        this.heldByState.delete(dataFrame);
        if (!this.hostHolds.has(dataFrame)) {
            this.destroy(dataFrame);
        }
    }

    private destroy(dataFrame: DataFrame) {
        void dataFrame.destroy().catch(error => {
            this.logger.warn("Failed to destroy released data frame", {
                "tableName": dataFrame.tableName,
                "error": error instanceof Error ? error.message : String(error),
            }, LOG_CTX);
        });
    }
}
