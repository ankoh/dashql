// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as model from '../model';
import * as arrow from 'apache-arrow';
import { ADD_TABLE } from '../model/plan_context';
import { ProgramTaskLogic, SetupTaskLogic } from './task_logic';
import { TaskExecutionContext } from './task_execution_context';

export async function collectTableInfo(
    conn: duckdb.AsyncConnection,
    info: model.TableSummary,
): Promise<model.TableSummary> {
    const columnNames: string[] = [];
    const columnNameMapping: Map<string, number> = new Map();
    const columnTypes: arrow.DataType[] = [];
    const describe = await conn.runQuery<{ Field: arrow.Utf8; Type: arrow.Utf8 }>(`DESCRIBE ${info.nameQualified}`);
    let column = 0;
    for (const row of describe) {
        columnNames.push(row.Field);
        columnNameMapping.set(row.Field, column++);
        const mapType = (type: string): arrow.DataType => {
            switch (type) {
                case 'BOOLEAN':
                    return new arrow.Bool();
                case 'TINYINT':
                    return new arrow.Int8();
                case 'SMALLINT':
                    return new arrow.Int16();
                case 'INTEGER':
                    return new arrow.Int32();
                case 'BIGINT':
                    return new arrow.Int64();
                case 'UTINYINT':
                    return new arrow.Uint8();
                case 'USMALLINT':
                    return new arrow.Uint16();
                case 'UINTEGER':
                    return new arrow.Uint32();
                case 'UBIGINT':
                    return new arrow.Uint64();
                case 'FLOAT':
                    return new arrow.Float32();
                case 'HUGEINT':
                    return new arrow.Decimal(32, 0);
                case 'DOUBLE':
                    return new arrow.Float64();
                case 'VARCHAR':
                    return new arrow.Utf8();
                case 'DATE':
                    return new arrow.DateDay();
                case 'TIME':
                    return new arrow.Time(arrow.TimeUnit.MILLISECOND, 32);
                case 'TIMESTAMP':
                    return new arrow.TimeNanosecond();
                default:
                    return new arrow.Null();
            }
        };
        columnTypes.push(mapType(row.Type));
    }
    const timeUpdated = new Date();
    return {
        ...info,
        columnNames,
        columnTypes,
        columnNameMapping,
        timeUpdated,
    };
}

export class CreateTableTaskLogic extends ProgramTaskLogic {
    constructor(task_id: model.TaskHandle, task: proto.task.ProgramTask, statement: model.Statement) {
        super(task_id, task, statement);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(ctx: TaskExecutionContext): Promise<void> {
        const script = this.script;
        if (!script) return;

        const db = ctx.database;
        const table = await db.use(async (c: duckdb.AsyncConnection) => {
            /// First run the query
            await c.runQuery(script);

            // Return plan object
            const now = new Date();
            return await collectTableInfo(c, {
                objectId: this.buffer.objectId(),
                objectType: model.PlanObjectType.TABLE_SUMMARY,
                timeCreated: now,
                timeUpdated: now,
                nameQualified: this.buffer.nameQualified() || '',
                tableType: model.TableType.TABLE,
                columnNames: [],
                columnNameMapping: new Map(),
                columnTypes: [],
            });
        });
        if (table) {
            ctx.planContextDiff.push({
                type: ADD_TABLE,
                data: table,
            });
        }
    }
}

export class ModifyTableTaskLogic extends ProgramTaskLogic {
    constructor(task_id: model.TaskHandle, task: proto.task.ProgramTask, statement: model.Statement) {
        super(task_id, task, statement);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(_ctx: TaskExecutionContext): Promise<void> {}
}

export class ImportTableTaskLogic extends SetupTaskLogic {
    constructor(task_id: model.TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(_ctx: TaskExecutionContext): Promise<void> {}
}

export class DropTableTaskLogic extends SetupTaskLogic {
    constructor(task_id: model.TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(ctx: TaskExecutionContext): Promise<void> {
        const db = ctx.database;
        const table = ctx.planContext.tables.get(this.buffer.objectId());
        if (table === undefined) return;
        const dropTarget = table.tableType == model.TableType.VIEW ? 'VIEW' : 'TABLE';
        await db.use(async (c: duckdb.AsyncConnection) => {
            await c.runQuery(`DROP ${dropTarget} IF EXISTS ${this.buffer.nameQualified()}`);
        });
    }
}
