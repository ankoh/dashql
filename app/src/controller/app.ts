import { CoreWasmBindings } from '@dashql/core';
import { AppReduxStore } from '../model';
import { EditorController } from './editor';
import { LogController } from './log';
import { InterpreterController } from './interpreter';
import { DemoController } from './demo';

/// The worker interval
const workerIntervalMS = 400;

/// A controller
export class AppController {
    /// The core
    protected _core: CoreWasmBindings;
    /// The store
    protected _store: AppReduxStore;
    /// The logger
    protected _log: LogController;
    /// The editor controller
    protected _editor: EditorController;
    /// The interpreter controller
    protected _interpreter: InterpreterController;
    /// The demo controller
    protected _demo: DemoController;

    /// The worker timeout
    protected workerTimer: number | null;

    // Constructor
    constructor(core: CoreWasmBindings, store: AppReduxStore) {
        this._core = core;
        this._store = store;
        this._log = new LogController(store);
        this._editor = new EditorController(this._core, this._store);
        this._interpreter = new InterpreterController(this._store);
        this._demo = new DemoController(this._core, this._store, this._log, this._editor, this._interpreter);
        this.workerTimer = null;
    }

    public get editor() { return this._editor; }
    public get interpreter() { return this._interpreter; }

    // Init the controller
    public async init(): Promise<void> {
        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);

        await this._core.init();
        this._demo.setup();
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
