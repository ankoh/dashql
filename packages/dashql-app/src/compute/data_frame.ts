import * as arrow from 'apache-arrow';

import { Logger } from '../platform/logger.js';
import { WebDBConnection } from '../webdb/api.js';

const LOG_CTX = "data_frame";

let nextTableId = 0;

export function generateTableName(prefix: string = "__df"): string {
    return `${prefix}_${nextTableId++}`;
}

export class DataFrame {
    readonly conn: WebDBConnection;
    readonly tableName: string;

    constructor(conn: WebDBConnection, tableName: string) {
        this.conn = conn;
        this.tableName = tableName;
    }

    static async fromArrowTable(conn: WebDBConnection, table: arrow.Table, tableName: string): Promise<DataFrame> {
        await conn.insertArrowTable(table, { name: tableName, create: true });
        return new DataFrame(conn, tableName);
    }

    static async fromSQL(conn: WebDBConnection, sql: string, tableName: string): Promise<DataFrame> {
        await conn.query(`CREATE TABLE "${tableName}" AS ${sql}`);
        return new DataFrame(conn, tableName);
    }

    async readTable(): Promise<arrow.Table> {
        return await this.conn.query(`SELECT * FROM "${this.tableName}"`);
    }

    async destroy(): Promise<void> {
        await this.conn.query(`DROP TABLE IF EXISTS "${this.tableName}"`);
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
