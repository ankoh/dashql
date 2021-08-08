import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as core from '@dashql/core';
import * as model from '../model';

export class BrowserPlatform extends core.platform.Platform {
    /// The interpreter controller
    protected _scheduler: core.TaskGraphScheduler;
    /// The script pipeline
    protected _scriptPipeline: core.ScriptPipeline;

    constructor(
        store: model.AppReduxStore,
        logger: duckdb.Logger,
        db: duckdb.AsyncDuckDB,
        analyzer: core.analyzer.AnalyzerBindings,
        jmespath: () => Promise<core.jmespath.JMESPathBindings>,
    ) {
        super(store, logger, db, analyzer, jmespath);
        this._store = store;
        this._scheduler = new core.TaskGraphScheduler(this);
        this._scriptPipeline = new core.ScriptPipeline(this, this._scheduler);
    }
}
