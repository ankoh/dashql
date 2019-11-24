import * as proto from 'tigon-proto';
import { LogController } from './log_ctrl';
import { TaskID, Task, TaskQueue } from './task_queue';

export class TQLInterpreter {
    protected log: LogController;

    protected queuedTasks: TaskQueue;
    protected activeTasks: Array<Task>;
    protected requiredFor: Map<TaskID, Array<TaskID>>;

    // Constructor
    constructor(log: LogController) {
        this.log = log;
        this.queuedTasks = new TaskQueue();
        this.activeTasks = [];
        this.requiredFor = new Map();
    }

    // Evaluate a single statement
    public async evalStatement(_module: proto.tql.Module, _statement: number) {
    }

    // Evaluate a program
    public async eval(_module: proto.tql.Module) {
    }
}

export default TQLInterpreter;
