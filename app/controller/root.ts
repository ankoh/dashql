import * as Store from '../store';
import { CacheController } from './cache';
import { CoreController } from './core';
import { LogController } from './log';
import { EditorController } from './editor';
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
    // The interpreter
    public interpreter: TQLInterpreter;
    // The editor
    public editor: EditorController;
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
        this.editor = new EditorController(this.store, this.core);
        this.demo = new DemoController(this.store, this.core, this.log);
        this.interpreter = new TQLInterpreter(
            this.store,
            this.core,
            this.log,
            this.cache,
        );
        this.workerTimer = null;
    }

    // Init the controller
    public async init(): Promise<void> {
        this.core.init();
    }
}
