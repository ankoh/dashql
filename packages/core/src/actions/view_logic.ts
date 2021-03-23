import * as Immutable from 'immutable';
import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb/dist/webdb-async.module.js';
import * as model from '../model';
import { ActionHandle } from '../model';
import { ProgramActionLogic, SetupActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import { collectTableInfo } from './table_logic';
import ActionStatusCode = proto.action.ActionStatusCode;

export class ViewCreateActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext) {}

    public async execute(context: ActionContext): Promise<void> {
        const script = this.script;
        if (!script) return;

        const db = context.platform.database;
        const table = await db.use(async (c: webdb.AsyncConnection) => {
            /// First run the query
            await c.runQuery(script);

            // Return plan object
            const now = new Date();
            return await collectTableInfo(c, {
                objectId: this.buffer.objectId(),
                objectType: model.PlanObjectType.DATABASE_TABLE_INFO,
                timeCreated: now,
                timeUpdated: now,
                tableNameQualified: this.buffer.targetNameQualified() || '',
                tableNameShort: this.buffer.targetNameShort() || '',
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

export class ImportViewActionLogic extends SetupActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepare(_context: ActionContext) {}

    public async execute(_context: ActionContext): Promise<void> {}
}

export class DropViewActionLogic extends SetupActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepare(_context: ActionContext) {}

    public async execute(context: ActionContext): Promise<void> {
        const db = context.platform.database;
        await db.use(async (c: webdb.AsyncConnection) => {
            console.log(`DROP VIEW IF EXISTS ${this.buffer.targetNameShort()}`);
            await c.runQuery(`DROP VIEW IF EXISTS ${this.buffer.targetNameShort()}`);
        });
    }
}
