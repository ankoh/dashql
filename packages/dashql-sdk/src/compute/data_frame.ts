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

export class DataFrameRegistry {
    logger: Logger;
    registeredDataFrames: Map<DataFrame, number> = new Map();

    constructor(logger: Logger) {
        this.logger = logger;
    }

    public getRegisteredDataFrames() {
        return this.registeredDataFrames;
    }

    acquire(dataFrame: DataFrame | null | undefined, times: number = 1) {
        if (dataFrame == undefined || dataFrame == null) {
            return;
        }
        if (this.registeredDataFrames.has(dataFrame)) {
            this.registeredDataFrames.set(dataFrame, this.registeredDataFrames.get(dataFrame)! + times);
        } else {
            this.registeredDataFrames.set(dataFrame, times);
        }
    }

    release(dataFrame?: DataFrame | null) {
        if (dataFrame == undefined || dataFrame == null) {
            return;
        }
        if (this.registeredDataFrames.has(dataFrame)) {
            const count = this.registeredDataFrames.get(dataFrame)! - 1;
            if (count <= 0) {
                this.registeredDataFrames.delete(dataFrame);
                void dataFrame.destroy().catch(error => {
                    this.logger.warn("Failed to destroy released data frame", {
                        "tableName": dataFrame.tableName,
                        "error": error instanceof Error ? error.message : String(error),
                    }, LOG_CTX);
                });
            } else {
                this.registeredDataFrames.set(dataFrame, count);
            }
        } else {
            this.logger.warn("Attempted to release unknown data frame", {
                "tableName": dataFrame.tableName
            }, LOG_CTX);
        }
    }

    releaseMany(dataFrames: (DataFrame | null | undefined)[]) {
        for (const dataFrame of dataFrames) {
            this.release(dataFrame);
        }
    }
}
