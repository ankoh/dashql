import * as proto from '@dashql/proto';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as model from '../model';
import * as arrow from 'apache-arrow';
import * as Immutable from 'immutable';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import { TableStatisticsType } from '../model';
import { Column } from 'apache-arrow';

export async function collectTableInfo(conn: duckdb.AsyncConnection, info: model.Table): Promise<model.Table> {
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
        columnNameMapping,
        timeUpdated,
    };
}

export class CreateTableActionLogic extends ProgramActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext): void {}
    public willExecute(_context: ActionContext): void {}
    public async execute(context: ActionContext): Promise<void> {
        const script = this.script;
        if (!script) return;

        const db = context.platform.database;
        const table = await db.use(async (c: duckdb.AsyncConnection) => {
            /// First run the query
            await c.runQuery(script);

            // Return plan object
            const now = new Date();
            return await collectTableInfo(c, {
                objectId: this.buffer.objectId(),
                objectType: model.PlanObjectType.TABLE,
                timeCreated: now,
                timeUpdated: now,
                nameQualified: this.buffer.nameQualified() || '',
                tableType: model.TableType.TABLE,
                columnNames: [],
                columnNameMapping: new Map(),
                columnTypes: [],
                statistics: Immutable.Map<TableStatisticsType, Column<any>>(),
            });
        });
        if (table) {
            const store = context.platform.store;
            model.mutate(store.dispatch, {
                type: model.StateMutationType.INSERT_PLAN_OBJECTS,
                data: [table],
            });
        }
    }
}

export class ModifyTableActionLogic extends ProgramActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext): void {}
    public willExecute(_context: ActionContext): void {}
    public async execute(_context: ActionContext): Promise<void> {}
}

export class ImportTableActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepare(_context: ActionContext): void {}
    public willExecute(_context: ActionContext): void {}
    public async execute(_context: ActionContext): Promise<void> {}
}

export class DropTableActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepare(_context: ActionContext): void {}
    public willExecute(_context: ActionContext): void {}
    public async execute(context: ActionContext): Promise<void> {
        const db = context.platform.database;
        const store = context.platform.store;
        const state = store.getState();
        const table = state.core.planState.objects.get(this.buffer.objectId()) as model.Table;
        if (table === undefined) return;
        const dropTarget = table.tableType == model.TableType.VIEW ? 'VIEW' : 'TABLE';
        await db.use(async (c: duckdb.AsyncConnection) => {
            await c.runQuery(`DROP ${dropTarget} IF EXISTS ${this.buffer.nameQualified()}`);
        });
    }
}
