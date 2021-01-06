import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as core from '@dashql/core';
import * as model from '../model';

export class BrowserPlatform extends core.platform.Platform {
    /// The interpreter controller
    protected _scheduler: core.ActionGraphScheduler;
    /// The script pipeline
    protected _scriptPipeline: core.ScriptPipeline;

    constructor(store: model.AppReduxStore, webdb: webdb.AsyncWebDB, analyzer: core.analyzer.AnalyzerBindings) {
        super(store, webdb, analyzer);
        this._store = store;
        this._scheduler = new core.ActionGraphScheduler(this);
        this._scriptPipeline = new core.ScriptPipeline(this, this._scheduler);
    }


};

