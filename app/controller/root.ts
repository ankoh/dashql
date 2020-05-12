import * as Store from '../store';
import { CacheController } from './cache';
import { CoreController } from './core';
import { LogController } from './log';
import { TerminalController } from './terminal';
import { DemoController } from './demo';
import { TQLInterpreter } from './tql_interpreter';

// A controller
export class RootController {
    // The Store
    public store: Store.ReduxStore;
    // The logger
    public log: LogController;
    // The core
    public core: CoreController;
    // The cache
    public cache: CacheController;
    // The terminal
    public terminal: TerminalController;
    // The interpreter
    public interpreter: TQLInterpreter;

    // The demo
    public demo: DemoController;

    // The worker timeout
    protected workerTimer: number | null;

    // Constructor
    constructor(store: Store.ReduxStore) {
        this.store = store;
        this.log = new LogController(store);
        this.core = new CoreController();
        this.cache = new CacheController();
        this.terminal = new TerminalController();
        this.demo = new DemoController(this.store, this.core, this.log);
        this.interpreter = new TQLInterpreter(
            this.store,
            this.core,
            this.log,
            this.cache,
        );
        this.workerTimer = null;
    }

    // XXX Load the test environment
    async loadTestEnv() {
        await this.demo.init();
    }

    // Init the controller
    public async init(): Promise<void> {
        this.core.init();

        await this.loadTestEnv();
    }
}
