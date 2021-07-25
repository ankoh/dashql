import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import { AnalyzerBindings } from '../analyzer';
import { DatabaseManager } from './database_manager';
import { DerivedReduxStore } from '../model';
import { HTTPManager } from './http_manager';
import { Logger } from './log_manager';
import { JMESPathBindings } from '../jmespath';

export class Platform {
    /// The global application state
    _store: DerivedReduxStore;
    /// The logger
    _logger: Logger;
    /// The duckdb
    _duckdb: duckdb.AsyncDuckDB;
    /// The analyzer bindings
    _analyzer: AnalyzerBindings;
    /// The database manager
    _databaseManager: DatabaseManager;
    /// The HTTP manager
    _httpManager: HTTPManager;

    /// The jmespath resolver
    _jmespathResolver: () => Promise<JMESPathBindings>;
    /// Is initializing?
    _jmespathInit: Promise<JMESPathBindings> | null;
    /// The jmespath bindings (if loaded)
    _jmespath: JMESPathBindings | null;

    constructor(
        store: DerivedReduxStore,
        logger: duckdb.Logger,
        db: duckdb.AsyncDuckDB,
        analyzer: AnalyzerBindings,
        jmespath: () => Promise<JMESPathBindings>,
    ) {
        this._store = store;
        this._logger = logger;
        this._duckdb = db;
        this._analyzer = analyzer;
        this._databaseManager = new DatabaseManager(this._duckdb, this._store);
        this._httpManager = new HTTPManager(store, logger);
        this._jmespathResolver = jmespath;
        this._jmespathInit = null;
        this._jmespath = null;
    }

    public get store(): DerivedReduxStore {
        return this._store;
    }
    public get analyzer(): AnalyzerBindings {
        return this._analyzer;
    }
    public get database(): DatabaseManager {
        return this._databaseManager;
    }
    public get http(): HTTPManager {
        return this._httpManager;
    }
    public get logger(): Logger {
        return this._logger;
    }

    public async init(): Promise<void> {
        await this._databaseManager.init();
        await this._httpManager.init();
    }

    public async resolveJMESPath(): Promise<JMESPathBindings> {
        if (this._jmespath) return this._jmespath;
        if (this._jmespathInit) return this._jmespathInit;
        const init = async () => {
            this._jmespath = await this._jmespathResolver();
            return this._jmespath;
        };
        return await init();
    }
}
