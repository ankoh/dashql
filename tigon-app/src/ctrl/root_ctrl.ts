import * as Model from '../model';
import { CacheController } from './cache_ctrl';
import { CoreController } from './core_ctrl';
import { LogController } from './log_ctrl';
import { TerminalController } from './terminal_ctrl';

// The worker interval
const workerIntervalMS = 400;

// A controller
export class RootController {
    // The Model
    public store: Model.ReduxStore;
    // The logger
    public log: LogController;
    // The core
    public core: CoreController;
    // The cache
    public cache: CacheController;
    // The terminal
    public terminal: TerminalController;

    // The worker timeout
    protected workerTimer: number | null;

    // Constructor
    constructor(store: Model.ReduxStore) {
        this.store = store;
        this.log = new LogController(store);
        this.core = new CoreController();
        this.cache = new CacheController();
        this.terminal = new TerminalController();
        this.workerTimer = null;
    }

    // XXX Load the test environment
    async loadTestEnv() {
        await this.core.waitUntilReady();
        let session = await this.core.createSession();
        let tql = await this.core.parseTQL(session, `
            SELECT * FROM region, nation;
        `);
        this.store.dispatch(Model.setTransientTQLProgram(tql));
    }

    // Init the controller
    public async init(): Promise<void> {
        this.core.init();
        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);

        await this.loadTestEnv();

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

