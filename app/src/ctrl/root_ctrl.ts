import * as Store from '../store';
import { LogController } from './log_ctrl';

// The worker interval
const workerIntervalMS = 400;

// A controller
export class RootController {
    // The Store
    public store: Store.ReduxStore;
    // The logger
    public log: LogController;

    // The worker timeout
    protected workerTimer: number | null;

    // Constructor
    constructor(store: Store.ReduxStore) {
        this.store = store;
        this.log = new LogController(store);
        this.workerTimer = null;
    }

    // Init the controller
    public async init(): Promise<void> {
        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);

        return Promise.resolve();
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
