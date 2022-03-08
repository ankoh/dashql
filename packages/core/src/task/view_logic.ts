// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import * as model from '../model';
import { TaskHandle } from '../model';
import { ProgramTaskLogic, SetupTaskLogic } from './task_logic';
import { TaskExecutionContext } from './task_execution_context';

export class ViewCreateTaskLogic extends ProgramTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, statement: model.Statement) {
        super(task_id, task, statement);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(ctx: TaskExecutionContext): Promise<void> {
        const script = this.script;
        if (!script) return;

        await ctx.databaseConnection.query(script);
        await ctx.database.collectTableMetadata(ctx.databaseConnection, {
            nameQualified: this.buffer.nameQualified() || '',
            tableType: model.TableType.VIEW,
            tableID: this.buffer.objectId(),
            script,
        });
    }
}

export class DropViewTaskLogic extends SetupTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(ctx: TaskExecutionContext): Promise<void> {
        const table = ctx.database.metadata.tables.get(this.buffer.nameQualified()!);
        if (table === undefined) return;
        const dropTarget = table.tableType == model.TableType.VIEW ? 'VIEW' : 'TABLE';
        await ctx.databaseConnection.query(`DROP ${dropTarget} IF EXISTS ${this.buffer.nameQualified()}`);
    }
}
