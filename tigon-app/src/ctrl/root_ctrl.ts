import * as Model from '../model';
import { Logger } from './logger';
import { CoreAPI } from './core_api';

// The worker interval
const workerIntervalMS = 400;

// A controller
export class RootController {
    // The Model
    public store: Model.ReduxStore;
    // The logger
    public logger: Logger;
    // The core api
    public core: CoreAPI;

    // The worker timeout
    protected workerTimer: number | null;

    // Constructor
    constructor(store: Model.ReduxStore, logger: Logger) {
        this.store = store;
        this.logger = logger;
        this.workerTimer = null;
        this.core = new CoreAPI();
    }

    // Init the controller
    public init() {
        this.core.init();

        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);
    }


    // Run a query
    public runQuery(text: string) {
        //        this.core.runQuery(text);
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

