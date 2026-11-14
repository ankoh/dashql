import * as React from 'react';

import { ConnectionHealth, connectionCachesQueryResults, type ConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import { connectorOfDetails } from '@ankoh/dashql-sdk/connections/connector_descriptor';
import { useConnectionRegistry } from '../../connections/connection_registry.js';
import { useCancelQuery, useQueryExecutor } from '../../connections/query_executor.js';
import { useWorkbookScriptsDispatch, useWorkbookScriptsRegistry, useWorkbookScriptsRegistryReader, type ModifyWorkbookScripts } from './workbook_scripts_registry.js';
import { createExecutionMounts, isWorkbookExecutionRunning, runWorkbookExecution, subscribeWorkbookExecutions, type WorkbookExecutionState } from './workbook_execution.js';
import { useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { supportsParquet } from '@ankoh/dashql-sdk/platform/hyperdb/hyperdb_parquet_export';
import { registerScriptRunServices, type ScriptRunServices } from './script_run.js';
import { computeQueryCacheKeyForConnection } from '../../connections/query_executor.js';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import { isCloudPreview, scriptConnectionIds, SET_ATTACHMENT_COLUMNS } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import { isHyperWasmConnection } from '@ankoh/dashql-sdk/connections/connection_label';
import { QueryType } from '@ankoh/dashql-sdk/query/query_execution_state';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { mountWorkbookAttachments, readAttachmentColumns } from '@ankoh/dashql-sdk/workbook/attachments/attachment_mounts';
import { attachmentStamp } from '@ankoh/dashql-sdk/workbook/attachments/workbook_attachments';
import { stringifyError } from '@ankoh/dashql-sdk/platform/logger/logger';

const LOG_CTX = 'workbook_execution';

/// The options of a run of a workbook
export interface WorkbookExecutionOptions {
    /// Run the scripts that a change of these inputs affects. A run that holds the workbook stops, the run starts
    /// once the workbook is free, with the inputs of every change since.
    inputs?: readonly string[];
}

interface ExecutionContext {
    states: Map<string, WorkbookExecutionState>;
    /// Can a run start? A run reads the cached results and the results of the queries with the compute database, a
    /// run starts once it is set up
    ready: boolean;
    start: (workbookId: string, modify: ModifyWorkbookScripts, options?: WorkbookExecutionOptions) => void;
    stop: (workbookId: string) => void;
}

const CONTEXT = React.createContext<ExecutionContext | null>(null);

/// The number of statements of a workbook run that a connection executes at once
function maxConcurrentQueries(connection: ConnectionState | undefined): number {
    return connection == null ? 1 : connectorOfDetails(connection.details).maxConcurrentQueries(connection.details.value);
}

/// Does a connection run a query? The SQLFrame queries of computations run on the compute database,
/// the connection only tracks them.
function runsQueries(connection: ConnectionState): boolean {
    for (const query of connection.queriesActive.values()) {
        if (query.queryMetadata.queryType !== QueryType.INTERNAL_SQLFRAME) return true;
    }
    return false;
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

export function workbookExecutionIsBusy(state: WorkbookExecutionState | null | undefined): boolean {
    return state?.phase === 'planning' || state?.phase === 'running' || state?.phase === 'stopping';
}

/// The run of a workbook. `busy` while the whole workbook runs, `runActive` while any run holds the workbook, a run of
/// the workbook or of one of its scripts: the workbook starts no other run then.
export function useWorkbookExecution(workbookId: string) {
    const context = React.useContext(CONTEXT);
    const state = context?.states.get(workbookId) ?? null;
    const start = context?.start;
    const stop = context?.stop;
    const held = React.useSyncExternalStore(subscribeWorkbookExecutions, () => isWorkbookExecutionRunning(workbookId));
    return React.useMemo(() => {
        const busy = workbookExecutionIsBusy(state);
        return {
            state,
            busy,
            ready: context?.ready ?? false,
            runActive: busy || held,
            start: (modify: ModifyWorkbookScripts, options?: WorkbookExecutionOptions) => start?.(workbookId, modify, options),
            stop: () => stop?.(workbookId),
        };
    }, [state, held, start, stop, workbookId, context?.ready]);
}

export function WorkbookExecutionProvider(props: React.PropsWithChildren) {
    const [registry] = useWorkbookScriptsRegistry();
    // The registry as the last update left it, also before the next render
    const readRegistry = useWorkbookScriptsRegistryReader();
    const [connections] = useConnectionRegistry();
    const executeQuery = useQueryExecutor();
    const cancelQuery = useCancelQuery();
    const computeDb = useComputeDatabase();
    const queryResultCache = useQueryResultCache();
    const logger = useLogger();
    const [states, setStates] = React.useState(new Map<string, WorkbookExecutionState>());
    // The runs by workbook, with the connections that were online when the run started: the run executes statements
    // only on them
    const runs = React.useRef(new Map<string, { controller: AbortController; online: ReadonlySet<string> }>());
    const runningDatabases = React.useRef(new Set<string>());
    // The input changes that wait for the workbook, by workbook id
    const pendingInputs = React.useRef(new Map<string, { modify: ModifyWorkbookScripts; inputs: Set<string> }>());

    React.useEffect(() => () => {
        for (const { controller } of runs.current.values()) controller.abort();
    }, []);

    // The columns of the Parquet attachments, read once per file and stamp with the compute database
    const dispatchWorkbookScripts = useWorkbookScriptsDispatch();
    const describedAttachments = React.useRef(new Set<string>());
    React.useEffect(() => {
        if (!supportsParquet(computeDb)) return;
        for (const workbook of registry.workbookScriptsMap.values()) {
            for (const attachment of workbook.attachments ?? []) {
                if (attachment.columns != null) continue;
                const stamp = attachmentStamp(attachment);
                const key = `${workbook.workbookId}/${attachment.fileName}@${stamp}`;
                if (describedAttachments.current.has(key)) continue;
                describedAttachments.current.add(key);
                const { workbookId } = workbook;
                const fileName = attachment.fileName;
                readAttachmentColumns(computeDb, workbookId, fileName)
                    .then(columns => dispatchWorkbookScripts(workbookId, { type: SET_ATTACHMENT_COLUMNS, value: { fileName, stamp, columns } }))
                    .catch(error => logger.warn('Reading the columns of an attachment failed', { workbookId, fileName, error: stringifyError(error) }, LOG_CTX));
            }
        }
    }, [registry, computeDb, dispatchWorkbookScripts, logger]);
    React.useEffect(() => {
        // A run stops if a connection that it executes statements on drops, the others only serve cached results
        for (const [id, { controller, online }] of runs.current) {
            if (controller.signal.aborted) continue;
            const workbook = registry.workbookScriptsMap.get(id);
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
    }, [registry, connections, logger]);

    // The provider re-renders with every registry change.
    // Keep the context value stable and read the latest registries when an execution starts.
    const latest = React.useRef({ registry, connections, executeQuery, cancelQuery, computeDb, queryResultCache, logger });
    latest.current = { registry, connections, executeQuery, cancelQuery, computeDb, queryResultCache, logger };

    // A run of a script plans it with the scripts it references, the services read the latest registries
    const runServices = React.useMemo<ScriptRunServices>(() => ({
        createMounts: () => {
            const { computeDb, queryResultCache } = latest.current;
            return queryResultCache != null && supportsParquet(computeDb) ? createExecutionMounts(queryResultCache, computeDb) : null;
        },
        mountAttachments: async workbookId => {
            const { computeDb } = latest.current;
            if (!supportsParquet(computeDb)) throw new Error('Scripts that read attachments need the compute database');
            await mountWorkbookAttachments(computeDb, workbookId);
        },
        cacheKey: async (connectionId, signature) => {
            const connection = latest.current.connections.connections.get(connectionId);
            return connection == null ? null : await computeQueryCacheKeyForConnection(connection.details, signature);
        },
        cachesResults: connectionId => {
            const connection = latest.current.connections.connections.get(connectionId);
            return connection != null && connectionCachesQueryResults(connection);
        },
        get cache() { return latest.current.queryResultCache; },
        maxConcurrentQueries: connectionId => maxConcurrentQueries(latest.current.connections.connections.get(connectionId)),
        liveWorkbook: workbookId => (readRegistry?.() ?? latest.current.registry).workbookScriptsMap.get(workbookId) ?? null,
    }), [readRegistry]);
    // A layout effect, the passive effects of the children read the services, e.g. the cache indicators of the
    // cards. React runs passive effects child first and a registry change unregisters the services before it
    // registers them again: with a passive effect the children would plan with the plain services that cache
    // nothing in between.
    React.useLayoutEffect(() => {
        const instances = new Set([...registry.workbookScriptsMap.values()].map(workbook => workbook.instance));
        for (const instance of instances) registerScriptRunServices(instance, runServices);
        return () => {
            for (const instance of instances) registerScriptRunServices(instance, null);
        };
    }, [registry, runServices]);

    const startRef = React.useRef<(workbookId: string, modify: ModifyWorkbookScripts, options?: WorkbookExecutionOptions) => void>(() => {});
    const start = React.useCallback((workbookId: string, modifyWorkbookScripts: ModifyWorkbookScripts, options?: WorkbookExecutionOptions) => {
        const { connections, executeQuery, cancelQuery, computeDb, queryResultCache, logger } = latest.current;
        // The registry as the last update left it, an input change starts its run right after writing its tags
        const registry = readRegistry?.() ?? latest.current.registry;
        const workbook = registry.workbookScriptsMap.get(workbookId);
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
            const connections = latest.current.connections;
            // The compute database reads the cached results, a run before its setup would fail or skip them
            if (latest.current.computeDb == null) return 'the compute database is not set up';
            if (runs.current.has(workbookId) || isWorkbookExecutionRunning(workbookId)) return 'a run holds the workbook';
            for (const connectionId of connectionIds) {
                const connection = connections.connections.get(connectionId);
                if (connection == null) return `the connection ${connectionId} is unknown`;
                if (runningDatabases.current.has(connectionId)) return `a run holds the connection ${connectionId}`;
                if (connection.connectionHealth === ConnectionHealth.CONNECTING) return `the connection ${connectionId} is connecting`;
                if (runsQueries(connection)) return `the connection ${connectionId} runs a query`;
            }
            return null;
        };
        const isFree = () => blocker() == null;
        if (options?.inputs != null) {
            const pending = pendingInputs.current.get(workbookId);
            const inputs = new Set([...(pending?.inputs ?? []), ...options.inputs]);
            if (pending != null || !isFree()) {
                // The latest values win: stop the run that holds the workbook and start once the workbook is free
                pendingInputs.current.set(workbookId, { modify: modifyWorkbookScripts, inputs });
                runs.current.get(workbookId)?.controller.abort();
                if (pending == null) {
                    logger.info('A change of inputs waits for the workbook', { workbookId, inputs: [...inputs].join(', '), reason: blocker() }, LOG_CTX);
                    void whenWorkbookFree(isFree).then(free => {
                        const next = pendingInputs.current.get(workbookId);
                        pendingInputs.current.delete(workbookId);
                        if (next != null && free) startRef.current(workbookId, next.modify, { inputs: [...next.inputs] });
                        else if (next != null) logger.warn('Dropped a change of inputs, the workbook stayed busy', {
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
            const connection = latest.current.connections.connections.get(connectionId);
            return connection?.connectionHealth === ConnectionHealth.ONLINE && (!preview || isHyperWasmConnection(connection));
        }));
        logger.info('Starting the run of a workbook', {
            workbookId, inputs: options?.inputs?.join(', ') ?? null,
            online: connectionIds.filter(id => online.has(id)).join(', '),
            offline: connectionIds.filter(id => !online.has(id)).join(', '),
            cache: (queryResultCache != null && supportsParquet(computeDb)).toString(),
        }, LOG_CTX);
        runs.current.set(workbookId, { controller, online });
        for (const connectionId of connectionIds) runningDatabases.current.add(connectionId);
        void runWorkbookExecution({
            workbook,
            getWorkbook: () => (readRegistry?.() ?? latest.current.registry).workbookScriptsMap.get(workbookId) ?? null,
            inputs: options?.inputs,
            executeQuery, cancelQuery, modifyWorkbookScripts,
            maxConcurrentQueries: connectionId => maxConcurrentQueries(connections.connections.get(connectionId)),
            // The embedded Hyper scans the results of the scripts of other connections, mounted from the compute database
            mounts: queryResultCache != null && supportsParquet(computeDb) ? createExecutionMounts(queryResultCache, computeDb) : null,
            mountAttachments: runServices.mountAttachments,
            resultKey: runServices.cacheKey,
            cachesResults: runServices.cachesResults,
            cache: queryResultCache,
            canRun: connectionId => online.has(connectionId),
            signal: controller.signal,
            logger,
            onState: state => setStates(previous => new Map(previous).set(workbookId, state)),
        }).finally(() => {
            runs.current.delete(workbookId);
            for (const connectionId of connectionIds) runningDatabases.current.delete(connectionId);
        });
    }, [runServices, readRegistry]);
    startRef.current = start;
    const stop = React.useCallback((id: string) => runs.current.get(id)?.controller.abort(), []);
    const ready = computeDb != null;
    const value = React.useMemo<ExecutionContext>(() => ({ states, ready, start, stop }), [states, ready, start, stop]);

    return <CONTEXT.Provider value={value}>
        {props.children}
    </CONTEXT.Provider>;
}
