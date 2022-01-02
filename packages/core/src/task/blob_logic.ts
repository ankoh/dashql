// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import { TaskHandle } from '../model';
import { SetupTaskLogic } from './task_logic';
import { TaskExecutionContext } from './task_execution_context';

export class DropBlobTaskLogic extends SetupTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}
    public async execute(_ctx: TaskExecutionContext): Promise<void> {}
}
