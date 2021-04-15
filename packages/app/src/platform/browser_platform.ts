import * as duckdb from '@dashql/duckdb/dist/duckdb-browser-parallel.js';
import * as core from '@dashql/core';
import * as model from '../model';

export class BrowserPlatform extends core.platform.Platform {
    /// The interpreter controller
    protected _scheduler: core.ActionGraphScheduler;
    /// The script pipeline
    protected _scriptPipeline: core.ScriptPipeline;

    constructor(
        store: model.AppReduxStore,
        logger: duckdb.Logger,
        db: duckdb.AsyncDuckDB,
        analyzer: core.analyzer.AnalyzerBindings,
    ) {
        super(store, logger, db, analyzer);
        this._store = store;
        this._scheduler = new core.ActionGraphScheduler(this);
        this._scriptPipeline = new core.ScriptPipeline(this, this._scheduler);
    }
}
