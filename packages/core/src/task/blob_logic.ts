import * as proto from '@dashql/proto';
import { TaskHandle } from '../model';
import { SetupTaskLogic } from './task_logic';
import { TaskContext } from './task_context';

export class ImportBlobTaskLogic extends SetupTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_context: TaskContext): void {}
    public willExecute(_context: TaskContext): void {}
    public async execute(_context: TaskContext): Promise<void> {}
}

export class DropBlobTaskLogic extends SetupTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.SetupTask) {
        super(task_id, task);
    }

    public prepare(_context: TaskContext): void {}
    public willExecute(_context: TaskContext): void {}
    public async execute(_context: TaskContext): Promise<void> {}
}
