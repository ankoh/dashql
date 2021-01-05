import * as core from '@dashql/core';
import { DemoController } from './demo';

/// A controller
export class AppController {
    /// The platform
    protected _platform: core.platform.Platform;
    /// The interpreter controller
    protected _scheduler: core.ActionGraphScheduler;
    /// The script pipeline
    protected _scriptPipeline: core.ScriptPipeline;
    /// The demo controller
    protected _demo: DemoController;

    // Constructor
    constructor(platform: core.platform.Platform) {
        this._platform = platform;
        this._scheduler = new core.ActionGraphScheduler(platform);
        this._scriptPipeline = new core.ScriptPipeline(platform, this._scheduler);
        this._demo = new DemoController(platform);
    }

    /// Get the platform
    public get platform() { return this._platform; }
    /// Get the scheduler
    public get scheduler() { return this._scheduler; }

    /// Init the controller
    public async init(): Promise<void> {
        await this._platform.analyzer.init();
        this._demo.setup();
    }
}
