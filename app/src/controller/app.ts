import { AppReduxStore } from '../store';
import { EditorController } from './editor';
import { LogController } from './log';
import { TerminalController } from './terminal';
import { InterpreterController } from './interpreter';
import { ParserController } from './parser';

/// The worker interval
const workerIntervalMS = 400;

/// A controller
export class AppController {
    /// The Store
    protected _store: AppReduxStore;
    /// The parser
    protected _parser: ParserController;
    /// The logger
    protected _log: LogController;
    /// The editor controller
    protected _editor: EditorController;
    /// The interpreter controller
    protected _interpreter: InterpreterController;
    /// The terminal controller
    protected _terminal: TerminalController;

    /// The worker timeout
    protected workerTimer: number | null;

    // Constructor
    constructor(store: AppReduxStore) {
        this._store = store;
        this._parser = new ParserController();
        this._log = new LogController(store);
        this._editor = new EditorController(this._store, this._parser);
        this._interpreter = new InterpreterController(this._store);
        this._terminal = new TerminalController();
        this.workerTimer = null;
    }

    public get editor() { return this._editor; }
    public get interpreter() { return this._interpreter; }
    public get terminal() { return this._terminal; }

    // Init the controller
    public async init(): Promise<void> {
        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);

        await this._parser.init();
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
