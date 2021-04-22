import * as proto from '@dashql/proto';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as model from '../model';
import * as arrow from 'apache-arrow';
import * as Immutable from 'immutable';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';

/// XXX Delete this eventually in favor of the async statistics requests
export async function collectTableInfo(conn: duckdb.AsyncConnection, info: model.Table): Promise<model.Table> {
    // Get column names and types
    const limit0 = await conn.runQuery(`SELECT * FROM ${info.nameQualified} LIMIT 0`);
    const columnNames: string[] = [];
    const columnNameMapping: Map<string, number> = new Map();
    const columnTypes: arrow.DataType[] = [];
    for (let ci = 0; ci < limit0.schema.fields.length; ++ci) {
        const field = limit0.schema.fields[ci];
        console.log(`field: ${field.name} => ${ci}`);
        columnNames.push(field.name);
        columnNameMapping.set(field.name, ci);
        columnTypes.push(field.type);
    }
    const timeUpdated = new Date();
    return {
        ...info,
        columnNames,
        columnNameMapping,
        columnTypes,
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
                columnNames: [],
                columnNameMapping: new Map(),
                columnTypes: [],
                statistics: Immutable.Map(),
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
        await db.use(async (c: duckdb.AsyncConnection) => {
            await c.runQuery(`DROP TABLE IF EXISTS ${this.buffer.nameQualified()}`);
        });
    }
}
