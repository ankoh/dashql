import { AppReduxStore } from '../store';
import { EditorController } from './editor_ctrl';
import { LogController } from './log_ctrl';
import { Interpreter } from './interpreter';
import { DashQLParser } from '@dashql/parser';

/// The worker interval
const workerIntervalMS = 400;

/// A controller
export class AppController {
    /// The Store
    protected _store: AppReduxStore;
    /// The parser
    protected _parser: DashQLParser;
    /// The logger
    protected _log: LogController;
    /// The editor controller
    protected _editor: EditorController;
    /// The interpreter controller
    protected _interpreter: Interpreter;

    /// The worker timeout
    protected workerTimer: number | null;

    // Constructor
    constructor(store: AppReduxStore) {
        this._store = store;
        this._parser = new DashQLParser();
        this._log = new LogController(store);
        this._editor = new EditorController(this._store, this._parser);
        this._interpreter = new Interpreter(this._store);
        this.workerTimer = null;
    }

    public get editor() { return this._editor; }
    public get interpreter() { return this._interpreter; }

    // Init the controller
    public async init(): Promise<void> {
        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);

        this._parser.init();

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
