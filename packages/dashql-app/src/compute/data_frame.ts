import * as arrow from 'apache-arrow';

import { Logger } from '../platform/logger.js';
import { DuckDB, DuckDBConnection } from '../duckdb/duckdb_api.js';

const LOG_CTX = "data_frame";

let nextTableId = 0;

export function generateTableName(prefix: string = "__df"): string {
    return `${prefix}_${nextTableId++}`;
}

export class DataFrame {
    readonly duckdb: DuckDB;
    readonly tableName: string;

    constructor(duckdb: DuckDB, tableName: string) {
        this.duckdb = duckdb;
        this.tableName = tableName;
    }

    static async withConnection<T>(duckdb: DuckDB, fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
        const conn = await duckdb.connect();
        try {
            return await fn(conn);
        } finally {
            await conn.close();
        }
    }

    async withConnection<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
        return await DataFrame.withConnection(this.duckdb, fn);
    }

    static async fromArrowTable(duckdb: DuckDB, table: arrow.Table, tableName: string): Promise<DataFrame> {
        await DataFrame.withConnection(duckdb, async conn => {
            await conn.insertArrowTable(table, { name: tableName, create: true });
        });
        return new DataFrame(duckdb, tableName);
    }

    static async fromSQL(duckdb: DuckDB, sql: string, tableName: string): Promise<DataFrame> {
        await DataFrame.withConnection(duckdb, async conn => {
            await conn.query(`CREATE TABLE "${tableName}" AS ${sql}`);
        });
        return new DataFrame(duckdb, tableName);
    }

    async readTable(): Promise<arrow.Table> {
        return await this.withConnection(async conn => await conn.query(`SELECT * FROM "${this.tableName}"`));
    }

    async destroy(): Promise<void> {
        await this.withConnection(async conn => await conn.query(`DROP TABLE IF EXISTS "${this.tableName}"`));
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
            } else {
                this.registeredDataFrames.set(dataFrame, count);
            }
        } else {
            console.error("attempted to release unknown data frame");
            this.logger.error("attempted to release unknown data frame", {
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
