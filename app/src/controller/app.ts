import * as core from '@dashql/core';
import { EditorController } from './editor';
import { DemoController } from './demo';

/// The worker interval
const workerIntervalMS = 400;

/// A controller
export class AppController {
    /// The platform
    protected _platform: core.platform.Platform;
    /// The editor controller
    protected _editor: EditorController;
    /// The interpreter controller
    protected _scheduler: core.ActionGraphScheduler;
    /// The analyzer hooks
    protected _analyzerHooks: core.AnalyzerHooks;
    /// The demo controller
    protected _demo: DemoController;

    /// The worker timeout
    protected _workerTimer: number | null;

    // Constructor
    constructor(platform: core.platform.Platform) {
        this._platform = platform;
        this._editor = new EditorController(platform);
        this._scheduler = new core.ActionGraphScheduler(platform);
        this._analyzerHooks = new core.AnalyzerHooks(platform, this._scheduler);
        this._demo = new DemoController(platform);
        this._workerTimer = null;
    }

    /// Get the editor
    public get editor() { return this._editor; }
    /// Get the scheduler
    public get scheduler() { return this._scheduler; }

    /// Init the controller
    public async init(): Promise<void> {
        this._workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);

        await this._platform.analyzer.init();
        this._demo.setup();
    }

    /// The worker function
    protected worker() {
        // Clear the worker timer
        clearTimeout(this._workerTimer || undefined);

        // TODO

        // Reschedule worker
        this._workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);
    }
}
