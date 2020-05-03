import * as proto from 'tigon-proto';
import * as Store from '../store';
import { LogController } from './log_ctrl';
import { CoreController } from './core_ctrl';
import { CacheController } from './cache_ctrl';
import { TaskID, Task, TaskQueue } from './task_queue';

export class TQLInterpreter {
    protected store: Store.ReduxStore;
    protected log: LogController;
    protected core: CoreController;
    protected cache: CacheController;

    protected queuedTasks: TaskQueue;
    protected activeTasks: Array<Task>;
    protected requiredFor: Map<TaskID, Array<TaskID>>;

    // Constructor
    constructor(
        store: Store.ReduxStore,
        core: CoreController,
        log: LogController,
        cache: CacheController,
    ) {
        this.store = store;
        this.log = log;
        this.core = core;
        this.cache = cache;
        this.queuedTasks = new TaskQueue();
        this.activeTasks = [];
        this.requiredFor = new Map();
    }

    // Evaluate a single statement
    public async evalStatement(_module: proto.tql.Module, _statement: number) {}

    // Evaluate a program
    public async eval(_module: proto.tql.Module) {}
}

export default TQLInterpreter;
