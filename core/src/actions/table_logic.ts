import * as proto from "@dashql/proto";
import * as webdb from "@dashql/webdb/dist/webdb_async";
import * as model from "../model";
import * as Immutable from 'immutable';
import { ProgramActionLogic, SetupActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

/// XXX Delete this eventually in favor of the async statistics requests
export async function collectTableInfo(conn: webdb.AsyncConnection, info: model.DatabaseTableInfo): Promise<model.DatabaseTableInfo> {
    // Get column names and types
    const limit0 = await conn.runQuery(`SELECT * FROM ${info.tableNameShort} LIMIT 0`);
    const columnNames: string[] = [];
    const columnNameMapping: Map<string, number> = new Map();
    const columnTypes: webdb.SQLType[] = [];
    for (let ci = 0; ci < limit0.columnNamesLength(); ++ci) {
        const name = limit0.columnNames(ci);
        columnNames.push(name);
        columnNameMapping.set(name, ci);
        columnTypes.push(webdb.getSQLType(limit0.columnTypes(ci)));
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

    public prepareExecution(_context: ActionContext) {}

    public async execute(context: ActionContext): Promise<model.ActionHandle> {
        const script = this.script;
        if (!script) {
            return this.returnWithStatus(ActionStatusCode.COMPLETED);
        }

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
                tableNameQualified: this.buffer.targetNameQualified() || "",
                tableNameShort: this.buffer.targetNameShort() || "",
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
                data: [table]
            });
        }

        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
};

export class ModifyTableActionLogic extends ProgramActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public prepareExecution(_context: ActionContext) {}

    public async execute(_context: ActionContext): Promise<model.ActionHandle> {
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
};

export class ImportTableActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepareExecution(_context: ActionContext) {}

    public async execute(_context: ActionContext): Promise<model.ActionHandle> {
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}

export class DropTableActionLogic extends SetupActionLogic {
    constructor(action_id: model.ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public prepareExecution(_context: ActionContext) {}

    public async execute(context: ActionContext): Promise<model.ActionHandle> {
        const db = context.platform.database;
        await db.use(async (c: webdb.AsyncConnection) => {
            await c.runQuery(`DROP TABLE IF EXISTS ${this.buffer.targetNameShort()}`);
        });
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}