import * as Model from '../model';
import { LogController } from './log_ctrl';
import { CoreController } from './core_ctrl';

// The worker interval
const workerIntervalMS = 400;

// A controller
export class RootController {
    // The Model
    public store: Model.ReduxStore;
    // The logger
    public log: LogController;
    // The core api
    public core: CoreController;

    // The worker timeout
    protected workerTimer: number | null;

    // Constructor
    constructor(store: Model.ReduxStore) {
        this.store = store;
        this.log = new LogController(store);
        this.core = new CoreController();
        this.workerTimer = null;
    }

    // Init the controller
    public init() {
        this.core.init();
        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);
    }

    // The worker function
    protected worker() {
        // Clear the worker timer
        clearTimeout(this.workerTimer || undefined);

        // TODO

        // Reschedule worker
        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);
    }
}

