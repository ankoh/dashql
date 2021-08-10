import * as proto from '@dashql/proto';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as model from '../model';
import { ADD_TABLE } from '../model';
import { TaskHandle } from '../model';
import { ProgramTaskLogic, SetupTaskLogic } from './task_logic';
import { TaskExecutionContext } from './task_execution_context';
import { collectTableInfo } from './table_logic';

export class ViewCreateTaskLogic extends ProgramTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, statement: model.Statement) {
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
                tableType: model.TableType.VIEW,
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

export class ImportViewTaskLogic extends SetupTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(_ctx: TaskExecutionContext): Promise<void> {}
}

export class DropViewTaskLogic extends SetupTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(ctx: TaskExecutionContext): Promise<void> {
        await ctx.database.use(async (c: duckdb.AsyncConnection) => {
            await c.runQuery(`DROP VIEW IF EXISTS ${this.buffer.nameQualified()}`);
        });
    }
}
