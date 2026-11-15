import * as core from '@ankoh/dashql-core';
import type * as arrow from 'apache-arrow';

import { clientContextJson, createComputePlatform, type CreateComputeQueryExecution } from './compute/compute_platform.js';
import type { EmbeddedClientContext, EmbeddedComputeDatabase } from './platform/database/embedded_database.js';
import { stringifyError, type Logger } from './platform/logger/logger.js';
import { HandleTable } from './store/handles.js';
import { RuntimeStore } from './store/runtime_store.js';
import { createRuntimeTables, isArrowTable } from './store/runtime_tables.js';
import type { UpdateScheduler } from './store/store.js';

const LOG_CTX = 'runtime';

/// What the runtime of the module needs of the platform of TypeScript
export interface CoreRuntimeOptions {
    logger: Logger;
    /// When the store takes the changes of the runtime
    scheduler: UpdateScheduler;
    /// The core, or the setup of the core that the first command asks for. Without, the default core is instantiated.
    setupCore?: ((context: string) => Promise<core.DashQL>) | core.DashQL | null;
    /// The compute database of the computations, null until the platform set it up
    computeDatabase?: EmbeddedComputeDatabase | null;
}

/// The options of the analysis of a result
export interface AnalyzeTableOptions {
    /// The connection that ran the query of the result, its query history lists the queries of the computation
    connectionId?: string | null;
    /// The client context of the queries of a result without a connection, e.g. of the connection overview
    clientContext?: EmbeddedClientContext | null;
    /// Compute the summaries of the columns, false for a table that shows no column plots
    columnAggregates?: boolean;
    /// Order the rows before the analysis settles, e.g. like the result that the result replaces
    ordering?: core.ComputationOrderBy[];
}

/// The runtime of the module on the platform of TypeScript (docs/wip/runtime_api.md): the `Runtime` class of the core
/// with its platform object (the clock, the log, the handle table, the Arrow tables by handle, the compute database)
/// and the store that the app reads its views from.
///
/// The runtime of the module needs the instantiated core. The app creates this object before the core is set up: the
/// views are empty and a dispatch fails until the core is there, a command asks the platform for it.
export class CoreRuntime {
    /// The handle table of the platform: the Arrow tables of the computations and the lifetimes of the computations
    readonly handles = new HandleTable();
    /// The views of the runtime
    readonly store: RuntimeStore;
    private readonly logger: Logger;
    private readonly setupCore: ((context: string) => Promise<core.DashQL>) | null;
    private computeDatabase: EmbeddedComputeDatabase | null;
    private queryExecution: CreateComputeQueryExecution | null = null;
    private compute: core.ComputePlatform | null = null;
    private module: core.Runtime | null = null;
    private pending: Promise<core.Runtime> | null = null;
    private destroyed = false;

    constructor(options: CoreRuntimeOptions) {
        this.logger = options.logger;
        this.store = new RuntimeStore(this.handles, options.scheduler);
        this.computeDatabase = options.computeDatabase ?? null;
        const setupCore = options.setupCore ?? null;
        this.setupCore = typeof setupCore === 'function' ? setupCore : null;
        if (setupCore != null && typeof setupCore !== 'function') this.setCore(setupCore);
    }

    /// The platform object that the runtime of the module calls
    private platform(): core.RuntimePlatform {
        const logger = this.logger;
        const runtime = this;
        return {
            clock: {
                now: () => Date.now(),
                sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
            },
            log: (level, message, details) => logger[level](message, Object.fromEntries(details), LOG_CTX),
            handles: this.handles,
            tables: createRuntimeTables(this.handles),
            get compute() {
                return runtime.computePlatform();
            },
            changed: urgent => this.store.changed(urgent),
        };
    }

    private computePlatform(): core.ComputePlatform | null {
        if (this.compute == null && this.computeDatabase != null) {
            this.compute = createComputePlatform(this.computeDatabase, () => this.queryExecution);
        }
        return this.compute;
    }

    /// Give the runtime its core, e.g. the one that the runtime of the app restored with. Later cores are ignored.
    setCore(instance: core.DashQL): void {
        if (this.destroyed || this.module != null) return;
        this.module = instance.createRuntime(this.platform());
        this.store.attach(this.module);
    }

    /// The runtime of the module, the core is set up with the first call
    private ready(): Promise<core.Runtime> {
        if (this.module != null) return Promise.resolve(this.module);
        if (this.pending == null) {
            this.pending = (async () => {
                let instance: core.DashQL | null = null;
                if (this.setupCore != null) {
                    try {
                        instance = await this.setupCore('runtime');
                    } catch (e) {
                        this.logger.warn('The platform has no core for the runtime, instantiating the default one', { error: stringifyError(e) }, LOG_CTX);
                    }
                }
                this.setCore(instance ?? await core.DashQL.create());
                if (this.module == null) throw new Error('the runtime was destroyed');
                return this.module;
            })();
            this.pending.catch(() => { this.pending = null; });
        }
        return this.pending;
    }

    /// Set the compute database once the platform set it up, the tasks that start later use it
    setComputeDatabase(database: EmbeddedComputeDatabase | null): void {
        if (database === this.computeDatabase) return;
        this.computeDatabase = database;
        this.compute = null;
    }

    /// Track the queries of the tasks, e.g. in the query history of the connection of a computation
    setQueryExecution(create: CreateComputeQueryExecution | null): void {
        this.queryExecution = create;
    }

    /// Apply an action to a slice. Fails without a core, a computation can't exist without one.
    dispatch(target: core.Target, action: core.RuntimeAction): core.DispatchOutcome {
        if (this.module == null) return { ok: false, changed: false, error: 'the runtime has no core yet' };
        return this.module.dispatch(target, action);
    }

    /// Delete the computation of a result
    deleteComputation(tableId: number): void {
        this.dispatch({ computation: tableId }, { kind: 'deleteComputation' });
    }

    /// Analyze a result as the computation of a table: its statistics, the system columns that the filters use, the
    /// summaries of its columns and the ordering of the options. Settles once the analysis is done and its views are
    /// in the store, fails with the error of a failed task. A result without columns has nothing to analyze.
    async analyzeTable(tableId: number, table: arrow.Table, options: AnalyzeTableOptions = {}): Promise<void> {
        if (table.numCols === 0) return;
        const module = await this.ready();
        const handle = this.handles.register(table);
        let analysis: Promise<void>;
        try {
            analysis = module.analyzeTable(tableId, handle, {
                connectionId: options.connectionId ?? undefined,
                clientContext: clientContextJson(options.clientContext) ?? undefined,
                columnAggregates: options.columnAggregates !== false,
                ordering: options.ordering,
            });
        } catch (e) {
            // The analysis didn't start, the table stays with the caller
            this.handles.release(handle);
            throw e;
        }
        try {
            await analysis;
        } finally {
            this.store.flush();
        }
    }

    /// An Arrow table of the handle table, undefined for none
    table(handle: number | null | undefined): arrow.Table | undefined {
        const table = this.handles.get(handle);
        return isArrowTable(table) ? table : undefined;
    }

    /// Take the changes of the runtime now
    flush(): void {
        this.store.flush();
    }

    /// Stop the runtime: its computations go, their runs are cancelled and their tables released
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        const module = this.module;
        this.module = null;
        if (module != null) {
            module.destroy();
            this.store.flush();
            module.free();
        }
        this.store.dispose();
    }
}
