import { ConnectionHealth, connectionCachesQueryResults, type ConnectionState } from '../../connections/connection_state.js';
import type { ConnectionRegistry } from '../../connections/connection_registry_state.js';
import { connectionMaxConcurrentQueries } from '../../connections/connector_descriptor.js';
import type { CancelQuery, QueryExecutor } from '../../connections/query_execution_args.js';
import { computeQueryCacheKeyForConnection } from '../../query/query_platform.js';
import { isHyperWasmConnection } from '../../connections/connection_label.js';
import { createExecutionMounts, isWorkbookExecutionRunning, runWorkbookExecution, type WorkbookExecutionState, type WorkbookRuns } from './workbook_execution.js';
import type { ScriptRunServices } from './script_run.js';
import { isCloudPreview, scriptConnectionIds, type WorkbookAction, type WorkbookScripts } from './workbook_scripts.js';
import type { EmbeddedComputeDatabase } from '../../platform/database/embedded_database.js';
import { supportsParquet } from '../../platform/hyperdb/hyperdb_parquet_export.js';
import type { QueryResultCache } from '../../query/query_result_cache.js';
import { QueryType } from '../../query/query_execution_state.js';
import { mountWorkbookAttachments, readAttachmentColumns } from '../attachments/attachment_mounts.js';
import { attachmentStamp } from '../attachments/workbook_attachments.js';
import { stringifyError, type Logger } from '../../platform/logger/logger.js';
import { Store } from '../../store/store.js';

const LOG_CTX = 'workbook_execution';

/// The options of a run of a workbook
export interface WorkbookExecutionOptions {
    /// Run the scripts that a change of these inputs affects. A run that holds the workbook stops, the run starts
    /// once the workbook is free, with the inputs of every change since.
    inputs?: readonly string[];
}

/// What the runs of workbooks need. The host replaces them as they change, a run reads the latest ones when it starts.
export interface WorkbookExecutionDependencies {
    logger: Logger;
    /// The workbooks of the last flush of the store
    readWorkbooks: () => Iterable<WorkbookScripts>;
    /// A workbook of the last flush of the store
    readWorkbook: (workbookId: string) => WorkbookScripts | null;
    /// The runs of the runtime
    runs: WorkbookRuns;
    /// The latest connection registry
    readConnections: () => Pick<ConnectionRegistry, 'connections'>;
    executeQuery: QueryExecutor;
    cancelQuery: CancelQuery;
    /// Apply an action to a workbook
    dispatchWorkbookScripts: (workbookId: string, action: WorkbookAction) => unknown;
    /// The database of the computations, null until it is ready. It reads the cached results.
    computeDatabase: EmbeddedComputeDatabase | null;
    /// The cache of query results, null without one
    resultCache: QueryResultCache | null;
}

/// The number of statements of a workbook run that a connection executes at once
const maxConcurrentQueries = connectionMaxConcurrentQueries;

/// Does a connection run a query? The SQLFrame queries of computations run on the compute database,
/// the connection only tracks them.
function runsQueries(connection: ConnectionState): boolean {
    return connection.queriesRunning > 0;
}

/// The attempts to wait for a run of a workbook to leave its connections
const FREE_ATTEMPTS = 50;
const FREE_INTERVAL_MS = 100;

/// Wait until a workbook is free for a run: no run holds it and its connections are idle. Gives up after a while, a
/// connection may stay busy.
function whenWorkbookFree(isFree: () => boolean): Promise<boolean> {
    return new Promise(resolve => {
        let attempts = 0;
        const check = () => {
            if (isFree()) {
                resolve(true);
            } else if (++attempts > FREE_ATTEMPTS) {
                resolve(false);
            } else {
                setTimeout(check, FREE_INTERVAL_MS);
            }
        };
        check();
    });
}

/// Is the run of a workbook planning, running or stopping?
export function workbookExecutionIsBusy(state: WorkbookExecutionState | null | undefined): boolean {
    return state?.phase === 'planning' || state?.phase === 'running' || state?.phase === 'stopping';
}

/// Runs whole workbooks (Execute All) and serves the runs of single scripts: one run per workbook, on the connections
/// that were online when it started, stopped when one of them drops or the workbook is gone.
export class WorkbookExecutionService {
    private readonly deps: WorkbookExecutionDependencies;
    /// The states of the runs, by workbook
    readonly states = new Store<Map<string, WorkbookExecutionState>>(new Map());
    /// The runs by workbook, with the connections that were online when the run started: the run executes statements
    /// only on them
    private readonly runs = new Map<string, { controller: AbortController; online: ReadonlySet<string> }>();
    private readonly runningDatabases = new Set<string>();
    /// The input changes that wait for the workbook, by workbook id
    private readonly pendingInputs = new Map<string, { inputs: Set<string> }>();
    /// The Parquet attachments whose columns were read, by workbook, file and stamp
    private readonly describedAttachments = new Set<string>();


    /// The services of the runs of single scripts, they plan a script with the scripts it references and read the
    /// latest registries
    readonly scriptRunServices: ScriptRunServices;

    constructor(deps: WorkbookExecutionDependencies) {
        this.deps = deps;
        const service = this;
        this.scriptRunServices = {
            runs: deps.runs,
            createMounts: () => {
                const { computeDatabase, resultCache } = service.deps;
                return resultCache != null && supportsParquet(computeDatabase) ? createExecutionMounts(resultCache, computeDatabase) : null;
            },
            mountAttachments: async workbookId => {
                const { computeDatabase } = service.deps;
                if (!supportsParquet(computeDatabase)) throw new Error('Scripts that read attachments need the compute database');
                await mountWorkbookAttachments(computeDatabase, workbookId);
            },
            cacheKey: async (connectionId, signature) => {
                const connection = service.deps.readConnections().connections.get(connectionId);
                return connection == null ? null : await computeQueryCacheKeyForConnection(connection, signature);
            },
            cachesResults: connectionId => {
                const connection = service.deps.readConnections().connections.get(connectionId);
                return connection != null && connectionCachesQueryResults(connection);
            },
            get cache() { return service.deps.resultCache; },
            maxConcurrentQueries: connectionId => maxConcurrentQueries(service.deps.readConnections().connections.get(connectionId)),
        };
    }

    /// Can a run start? A run reads the cached results and the results of the queries with the compute database, a
    /// run starts once it is set up
    get ready(): boolean {
        return this.deps.computeDatabase != null;
    }

    /// Follow new registries: read the columns of new Parquet attachments, stop the runs of workbooks that are gone and
    /// of connections that dropped
    followRegistries(workbooks: Iterable<WorkbookScripts>, connections: Pick<ConnectionRegistry, 'connections'>): void {
        const { computeDatabase, logger, dispatchWorkbookScripts } = this.deps;
        // The columns of the Parquet attachments, read once per file and stamp with the compute database
        if (supportsParquet(computeDatabase)) {
            for (const workbook of workbooks) {
                for (const attachment of workbook.attachments ?? []) {
                    if (attachment.columns != null) continue;
                    const stamp = attachmentStamp(attachment);
                    const key = `${workbook.workbookId}/${attachment.fileName}@${stamp}`;
                    if (this.describedAttachments.has(key)) continue;
                    this.describedAttachments.add(key);
                    const { workbookId } = workbook;
                    const fileName = attachment.fileName;
                    readAttachmentColumns(computeDatabase, workbookId, fileName)
                        .then(columns => dispatchWorkbookScripts(workbookId, { kind: 'setAttachmentColumns', value: { fileName, stamp, columns } }))
                        .catch(error => logger.warn('Reading the columns of an attachment failed', { workbookId, fileName, error: stringifyError(error) }, LOG_CTX));
                }
            }
        }
        // A run stops if a connection that it executes statements on drops, the others only serve cached results
        for (const [id, { controller, online }] of this.runs) {
            if (controller.signal.aborted) continue;
            const workbook = this.deps.readWorkbook(id);
            const dropped = [...online].find(connectionId =>
                connections.connections.get(connectionId)?.connectionHealth !== ConnectionHealth.ONLINE);
            if (!workbook) {
                logger.info('Stopping the run of a workbook that is gone', { workbookId: id }, LOG_CTX);
                controller.abort();
            } else if (dropped != null) {
                logger.info('Stopping the run of a workbook, a connection it runs statements on dropped', {
                    workbookId: id, connectionId: dropped, health: String(connections.connections.get(dropped)?.connectionHealth ?? 'gone'),
                }, LOG_CTX);
                controller.abort();
            }
        }
    }

    /// Start a run of a workbook, or queue a change of inputs until the workbook is free
    start = (workbookId: string, options?: WorkbookExecutionOptions): void => {
        const { executeQuery, cancelQuery, computeDatabase: computeDb, resultCache: queryResultCache, logger } = this.deps;
        const connections = this.deps.readConnections();
        // The registry as the last update left it, an input change starts its run right after writing its tags
        const workbook = this.deps.readWorkbook(workbookId);
        if (!workbook || workbook.scriptOrder.length === 0) return;
        // A preview of a published workbook runs only on the embedded Hyper, the scripts of its other connections serve
        // the published results until it is imported
        const preview = isCloudPreview(workbook);
        // A run takes every connection of the workbook, all of them must be idle. A run also starts while connections
        // aren't connected: their scripts serve their cached results, the others are skipped. A connection that is
        // connecting holds the run, it would join a moment later.
        const connectionIds = scriptConnectionIds(workbook);
        // Why the workbook can't run now, null if it can
        const blocker = (): string | null => {
            const connections = this.deps.readConnections();
            // The compute database reads the cached results, a run before its setup would fail or skip them
            if (this.deps.computeDatabase == null) return 'the compute database is not set up';
            if (this.runs.has(workbookId) || isWorkbookExecutionRunning(workbookId)) return 'a run holds the workbook';
            for (const connectionId of connectionIds) {
                const connection = connections.connections.get(connectionId);
                if (connection == null) return `the connection ${connectionId} is unknown`;
                if (this.runningDatabases.has(connectionId)) return `a run holds the connection ${connectionId}`;
                if (connection.connectionHealth === ConnectionHealth.CONNECTING) return `the connection ${connectionId} is connecting`;
                if (runsQueries(connection)) return `the connection ${connectionId} runs a query`;
            }
            return null;
        };
        const isFree = () => blocker() == null;
        if (options?.inputs != null) {
            const pending = this.pendingInputs.get(workbookId);
            const inputs = new Set([...(pending?.inputs ?? []), ...options.inputs]);
            if (pending != null || !isFree()) {
                // The latest values win: stop the run that holds the workbook and start once the workbook is free
                this.pendingInputs.set(workbookId, { inputs });
                this.runs.get(workbookId)?.controller.abort();
                if (pending == null) {
                    logger.info('A change of inputs waits for the workbook', { workbookId, inputs: [...inputs].join(', '), reason: blocker() }, LOG_CTX);
                    void whenWorkbookFree(isFree).then(free => {
                        const next = this.pendingInputs.get(workbookId);
                        this.pendingInputs.delete(workbookId);
                        if (next != null && free) this.start(workbookId, { inputs: [...next.inputs] });
                        else if (next != null) this.deps.logger.warn('Dropped a change of inputs, the workbook stayed busy', {
                            workbookId, inputs: [...next.inputs].join(', '), reason: blocker(),
                        }, LOG_CTX);
                    });
                }
                return;
            }
            options = { inputs: [...inputs] };
        }
        const blocked = blocker();
        if (blocked != null) {
            logger.info('Not starting the run of a workbook', { workbookId, reason: blocked }, LOG_CTX);
            return;
        }
        const controller = new AbortController();
        // A connection that comes online during the run doesn't join it
        const online = new Set(connectionIds.filter(connectionId => {
            const connection = connections.connections.get(connectionId);
            return connection?.connectionHealth === ConnectionHealth.ONLINE && (!preview || isHyperWasmConnection(connection));
        }));
        logger.info('Starting the run of a workbook', {
            workbookId, inputs: options?.inputs?.join(', ') ?? null,
            online: connectionIds.filter(id => online.has(id)).join(', '),
            offline: connectionIds.filter(id => !online.has(id)).join(', '),
            cache: (queryResultCache != null && supportsParquet(computeDb)).toString(),
        }, LOG_CTX);
        this.runs.set(workbookId, { controller, online });
        for (const connectionId of connectionIds) this.runningDatabases.add(connectionId);
        void runWorkbookExecution({
            workbook,
            runs: this.deps.runs,
            inputs: options?.inputs,
            executeQuery, cancelQuery,
            maxConcurrentQueries: connectionId => maxConcurrentQueries(connections.connections.get(connectionId)),
            // The embedded Hyper scans the results of the scripts of other connections, mounted from the compute database
            mounts: queryResultCache != null && supportsParquet(computeDb) ? createExecutionMounts(queryResultCache, computeDb) : null,
            mountAttachments: this.scriptRunServices.mountAttachments,
            resultKey: this.scriptRunServices.cacheKey,
            cachesResults: this.scriptRunServices.cachesResults,
            cache: queryResultCache,
            canRun: connectionId => online.has(connectionId),
            signal: controller.signal,
            logger,
            onState: state => this.states.update(previous => new Map(previous).set(workbookId, state)),
        }).finally(() => {
            this.runs.delete(workbookId);
            for (const connectionId of connectionIds) this.runningDatabases.delete(connectionId);
        });
    };

    /// Stop the run of a workbook
    stop = (workbookId: string): void => {
        this.runs.get(workbookId)?.controller.abort();
    };

    /// Stop every run
    stopAll(): void {
        for (const { controller } of this.runs.values()) controller.abort();
    }
}
