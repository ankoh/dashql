import * as Immutable from 'immutable';
import * as proto from '@dashql/proto';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as model from '../model';
import { TaskHandle, TableStatisticsType } from '../model';
import { ProgramTaskLogic, SetupTaskLogic } from './task_logic';
import { TaskContext } from './task_context';
import { collectTableInfo } from './table_logic';
import { Column } from 'apache-arrow';

export class ViewCreateTaskLogic extends ProgramTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, statement: model.Statement) {
        super(task_id, task, statement);
    }

    public prepare(_context: TaskContext): void {}
    public willExecute(_context: TaskContext): void {}
    public async execute(context: TaskContext): Promise<void> {
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
                objectType: model.PlanObjectType.TABLE_SUMMARY,
                timeCreated: now,
                timeUpdated: now,
                nameQualified: this.buffer.nameQualified() || '',
                tableType: model.TableType.VIEW,
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

export class ImportViewTaskLogic extends SetupTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_context: TaskContext): void {}
    public willExecute(_context: TaskContext): void {}
    public async execute(_context: TaskContext): Promise<void> {}
}

export class DropViewTaskLogic extends SetupTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_context: TaskContext): void {}
    public willExecute(_context: TaskContext): void {}
    public async execute(context: TaskContext): Promise<void> {
        const db = context.platform.database;
        await db.use(async (c: duckdb.AsyncConnection) => {
            await c.runQuery(`DROP VIEW IF EXISTS ${this.buffer.nameQualified()}`);
        });
    }
}
