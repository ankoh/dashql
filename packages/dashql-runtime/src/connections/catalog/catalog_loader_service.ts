import * as arrow from 'apache-arrow';

import type * as core from '@ankoh/dashql-core';

import { CatalogUpdateTaskStatus, CatalogUpdateVariant } from './catalog_update_state.js';
import { relationNames } from '../connection_state.js';
import { SalesforceApiClient, type SalesforceApiClientInterface } from '../salesforce/salesforce_api_client.js';
import { ConnectorType } from '../connector_info.js';
import type { QueryType } from '../../query/query_execution_state.js';
import type { Logger } from '../../platform/logger/logger.js';
import type { HttpClient } from '../../platform/http/http_client.js';
import type { RelationName } from './catalog_sql_generator.js';
import { loadClientFunctionSpec } from '../clfn/clfn_specs.js';
import type { CoreRuntime } from '../../core_runtime.js';

/// The issuer of the metadata queries
const CATALOG_QUERY_ISSUER = 'Catalog Update';

/// The catalog update args
export interface CatalogLoaderArgs {
    /// The relations to ask the connection about, everything if absent
    relations: RelationName[] | null;
}
/// The catalog updater function
export type CatalogLoader = (connectionId: string, args: CatalogLoaderArgs) => [number, Promise<void>];

/// What the catalog loader needs, replaced in tests
export interface CatalogLoaderDependencies {
    logger: Logger;
    /// The runtime that holds the connections and runs the metadata queries
    runtime: CoreRuntime;
    /// The HTTP client of the platform, the loader fetches the metadata of Salesforce with it
    http: HttpClient | null;
    /// The API of Salesforce of the platform. One that isn't the client over `http`, e.g. a mock, answers the metadata.
    salesforce: SalesforceApiClientInterface | null;
    /// Called when the catalog of a connection changed
    onCatalogDidUpdate?: (connectionId: string) => void;
}

/// What the adapter keeps of an update, the connection keeps it under a handle: an abort of the handle cancels the update
interface TaskRecord {
    connectionId: string;
    /// Aborted by the loader, the connection and the caller, it cancels the update in the loader
    cancellation: AbortController;
    abort(reason?: unknown): void;
}

/// The reason of a cancellation as text
function reasonOf(reason: unknown): string {
    if (reason instanceof Error) return reason.message;
    if (typeof reason === 'string') return reason;
    return 'Catalog refresh was cancelled';
}

/// A signal that aborts with the first of its signals
function anySignal(signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
}

/// Keeps the catalogs of the connections current: describes a connection when it comes online, refreshes on request
/// and asks a connection about the relations that executed statements touched.
///
/// An adapter over the catalog loader of the Rust runtime (`dashql_core_runtime::catalog_loader::service`): the loader
/// follows the connections of the runtime, schedules the updates, runs their metadata queries through the query
/// executor and publishes into the catalogs. The adapter tells it when the connections changed, applies the start and
/// the end of an update to the connection, keeps the cancellation of an update and runs the queries. The setups and
/// the catalog loader become commands of the runtime in step 3 of docs/wip/runtime_api.md.
export class CatalogLoaderService {
    private readonly deps: CatalogLoaderDependencies;
    private native: core.DashQLCatalogLoader | null = null;
    /// The running updates by task id
    private readonly tasks = new Map<number, TaskRecord>();
    /// The cancellations of the queries and requests of the loader by request id
    private readonly queryAborts = new Map<number, AbortController>();
    private readonly fetchAborts = new Map<number, AbortController>();
    /// The requests before the loader exists
    private readonly pending: [string, boolean][] = [];
    private started = false;

    constructor(deps: CatalogLoaderDependencies) {
        this.deps = deps;
    }

    /// The loader on the core of the runtime, created once the runtime has its core
    private nativeOf(): core.DashQLCatalogLoader | null {
        if (this.native != null) return this.native;
        const instance = this.deps.runtime.core;
        if (instance == null || this.deps.runtime.runtime == null) return null;
        const native = instance.createCatalogLoader(this.createHost());
        this.native = native;
        if (this.started) native.start();
        for (const [connectionId, force] of this.pending.splice(0)) native.enqueue(connectionId, force);
        return native;
    }

    /// Follow the connections of the runtime, e.g. after they changed
    follow(): void {
        const native = this.nativeOf();
        const runtime = this.deps.runtime.runtime;
        if (native != null && runtime != null) native.follow(runtime);
    }

    /// Request a refresh of the catalog of a connection, a forced one supersedes a running update
    enqueue = (connectionId: string, force: boolean): void => {
        if (this.native == null) {
            this.pending.push([connectionId, force]);
            return;
        }
        this.native.enqueue(connectionId, force);
    };

    /// Start an update of a connection right away, outside of the schedule
    update: CatalogLoader = (connectionId: string, args: CatalogLoaderArgs): [number, Promise<void>] => {
        const native = this.nativeOf();
        const runtime = this.deps.runtime.runtime;
        if (native == null || runtime == null) return [0, Promise.reject(new Error(`couldn't find a connection with id ${connectionId}`))];
        native.follow(runtime);
        return native.update(connectionId, args.relations);
    };

    /// Start scheduling, e.g. again after stop()
    start(): void {
        this.started = true;
        this.native?.start();
    }

    /// Stop scheduling, running updates finish
    stop(): void {
        this.started = false;
        this.native?.stop();
    }

    /// The task of an update, also one that the connection knows from before
    private taskOf(connectionId: string, taskId: number): TaskRecord | null {
        const task = this.tasks.get(taskId);
        if (task != null) return task;
        const running = this.deps.runtime.connection(connectionId)?.catalogUpdates.tasksRunning.find(task => task.taskId === taskId);
        return this.deps.runtime.handles.get<TaskRecord>(running?.handle) ?? null;
    }

    /// The host of the loader
    private createHost(): core.CatalogLoaderHost {
        const { logger, runtime } = this.deps;
        const dispatch = (connectionId: string, action: core.RuntimeAction) => runtime.dispatch({ connection: connectionId }, action);
        return {
            now: () => Date.now(),
            setTimer: (ms, callback) => setTimeout(callback, ms),
            clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
            log: (level, message, details, target) => {
                logger[level](message, JSON.parse(details), target);
            },
            fetch: async (requestId, request) => {
                const http = this.deps.http;
                if (http == null) throw new Error('the catalog loader has no HTTP client');
                const abort = new AbortController();
                this.fetchAborts.set(requestId, abort);
                try {
                    const response = await http.fetch(request.url, {
                        method: request.method,
                        headers: request.headers,
                        body: request.body ?? undefined,
                        signal: abort.signal,
                    });
                    const headers: [string, string][] = [];
                    response.headers.forEach((value, name) => headers.push([name, value]));
                    const body = new Uint8Array(await response.arrayBuffer());
                    return { status: response.status, statusText: response.statusText, headers, body };
                } finally {
                    this.fetchAborts.delete(requestId);
                }
            },
            abortFetch: requestId => {
                this.fetchAborts.get(requestId)?.abort(new DOMException('The request was cancelled', 'AbortError'));
            },
            updateStarted: (connectionId, taskId, variant, relations) => {
                const cancellation = new AbortController();
                // Every abort cancels the update in the loader: a forced refresh, a reset of the connection, the caller
                cancellation.signal.addEventListener('abort', () => {
                    this.native?.cancel(taskId, reasonOf(cancellation.signal.reason));
                }, { once: true });
                const record: TaskRecord = { connectionId, cancellation, abort: reason => cancellation.abort(reason) };
                this.tasks.set(taskId, record);
                // The connection keeps the record under its handle, a reset of the connection aborts it
                const handle = runtime.handles.register(record);
                const outcome = dispatch(connectionId, {
                    kind: 'updateCatalog',
                    value: {
                        taskId,
                        handle,
                        variant: variant === 0 ? CatalogUpdateVariant.FULL_CATALOG_REFRESH : CatalogUpdateVariant.RELATION_REFRESH,
                        startedAt: Date.now(),
                        touchedRelations: relationNames(JSON.parse(relations) as RelationName[]),
                    },
                });
                if (!outcome.ok) runtime.handles.release(handle);
            },
            abortUpdate: (connectionId, taskId, reason) => {
                const task = this.taskOf(connectionId, taskId);
                if (task != null && !task.cancellation.signal.aborted) {
                    task.cancellation.abort(new DOMException(reason, 'AbortError'));
                }
            },
            updateFinished: (connectionId, taskId, outcome) => {
                const task = this.taskOf(connectionId, taskId);
                this.tasks.delete(taskId);
                switch (outcome.status) {
                    case 'succeeded':
                        dispatch(connectionId, { kind: 'catalogUpdateFinished', value: { taskId, status: CatalogUpdateTaskStatus.SUCCEEDED, changed: outcome.catalogChanged } });
                        break;
                    case 'partiallySucceeded':
                        dispatch(connectionId, { kind: 'catalogUpdateFinished', value: { taskId, status: CatalogUpdateTaskStatus.PARTIALLY_SUCCEEDED, error: { message: outcome.error ?? '' } } });
                        break;
                    case 'failed':
                        dispatch(connectionId, { kind: 'catalogUpdateFinished', value: { taskId, status: CatalogUpdateTaskStatus.FAILED, error: { message: outcome.error ?? '' } } });
                        break;
                    case 'cancelled': {
                        const reason = task?.cancellation.signal.reason;
                        const message = reason instanceof Error ? reason.message : (outcome.error ?? 'Catalog refresh was cancelled');
                        dispatch(connectionId, { kind: 'catalogUpdateFinished', value: { taskId, status: CatalogUpdateTaskStatus.CANCELLED, error: { message } } });
                        break;
                    }
                }
                // Announce the new catalog, the scripts that use the connection are analyzed again
                if (outcome.announces) this.deps.onCatalogDidUpdate?.(connectionId);
            },
            runQuery: async (requestId, connectionId, taskId, query) => {
                const execute = runtime.execute;
                const abort = new AbortController();
                this.queryAborts.set(requestId, abort);
                try {
                    const task = this.taskOf(connectionId, taskId);
                    const abortSignal = task == null ? abort.signal : anySignal([task.cancellation.signal, abort.signal]);
                    const [queryId, execution] = execute(connectionId, {
                        query: query.sql,
                        abortSignal,
                        readTimeoutMs: query.readTimeoutMs ?? undefined,
                        throwOnError: true,
                        metadata: {
                            queryType: query.queryType as QueryType,
                            title: query.title,
                            description: null,
                            issuer: CATALOG_QUERY_ISSUER,
                            userProvided: false,
                        },
                    });
                    dispatch(connectionId, { kind: 'catalogUpdateRegisterQuery', value: { taskId, queryId } });
                    const table = await execution;
                    return table == null ? null : arrow.tableToIPC(table, 'stream');
                } finally {
                    this.queryAborts.delete(requestId);
                }
            },
            abortQuery: requestId => {
                this.queryAborts.get(requestId)?.abort(new DOMException('Catalog refresh was cancelled', 'AbortError'));
            },
            salesforceMetadata: async (connectionId, dataSpace) => {
                // The client over the HTTP client of the platform is what the loader does itself
                const api = this.deps.salesforce;
                if (api == null || api instanceof SalesforceApiClient) return null;
                const conn = runtime.connection(connectionId);
                if (conn?.connectorType !== ConnectorType.SALESFORCE_DATA_CLOUD || conn.details.connector.kind !== 'salesforce') return null;
                const token = conn.details.connector.oauthState?.coreAccessToken;
                if (token == null) throw new Error('Salesforce core access token is missing');
                const coreAccessToken = JSON.parse(token);
                const metadata = await api.getDataCloudMetadata(coreAccessToken, dataSpace, new AbortController().signal);
                return JSON.stringify(metadata);
            },
            loadSpec: async extension => JSON.stringify(await loadClientFunctionSpec(extension)),
            catalogChanged: connectionId => this.deps.onCatalogDidUpdate?.(connectionId),
        };
    }
}
