import * as arrow from 'apache-arrow';

import type * as core from '@ankoh/dashql-core';

import type { ConnectionRegistry, DynamicConnectionDispatch } from '../connection_registry_state.js';
import { CatalogUpdateTaskStatus, CatalogUpdateVariant } from './catalog_update_state.js';
import {
    CATALOG_UPDATE_CANCELLED,
    CATALOG_UPDATE_FAILED,
    CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
    CATALOG_UPDATE_REGISTER_QUERY,
    CATALOG_UPDATE_SUCCEEDED,
    UPDATE_CATALOG,
} from '../connection_state.js';
import { SalesforceApiClient, type SalesforceApiClientInterface } from '../salesforce/salesforce_api_client.js';
import type { SalesforceConnectionStateDetails } from '../salesforce/salesforce_connection_state.js';
import { SALESFORCE_DATA_CLOUD_CONNECTOR } from '../connector_info.js';
import type { QueryExecutor } from '../query_execution_args.js';
import type { QueryType } from '../../query/query_execution_state.js';
import type { Logger } from '../../platform/logger/logger.js';
import type { HttpClient } from '../../platform/http/http_client.js';
import type { RelationName } from './catalog_sql_generator.js';
import { loadClientFunctionSpec } from '../clfn/clfn_specs.js';
import type { NativeConnection } from '../connection_native.js';

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
    dispatchConnection: DynamicConnectionDispatch;
    execute: QueryExecutor | null;
    /// The HTTP client of the platform, the loader fetches the metadata of Salesforce with it
    http: HttpClient | null;
    /// The API of Salesforce of the platform. One that isn't the client over `http`, e.g. a mock, answers the metadata.
    salesforce: SalesforceApiClientInterface | null;
    /// Called when the catalog of a connection changed
    onCatalogDidUpdate?: (connectionId: string) => void;
}

/// What the adapter keeps of an update
interface TaskRecord {
    connectionId: string;
    /// Aborted by the loader, the connection and the caller, it cancels the update in the loader
    cancellation: AbortController;
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
/// follows the Rust connections of the registry, schedules the updates, runs their metadata queries through the query
/// executor and publishes into the catalogs. The adapter hands it the registry, applies the start and the end of an
/// update to the connection, keeps the cancellation of an update and runs the queries.
export class CatalogLoaderService {
    private readonly deps: CatalogLoaderDependencies;
    private registry: Pick<ConnectionRegistry, 'connections'> = { connections: new Map() };
    private native: core.DashQLCatalogLoader | null = null;
    /// The Rust connections that the loader follows by connection id
    private readonly followed = new Map<string, NativeConnection>();
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

    /// The loader of the core of the connections, created with the first connection. The cores of the connections are
    /// instances of one module.
    private nativeOf(registry: Pick<ConnectionRegistry, 'connections'>): core.DashQLCatalogLoader | null {
        if (this.native != null) return this.native;
        for (const conn of registry.connections.values()) {
            if (conn.native == null) continue;
            const native = conn.instance.createCatalogLoader(this.createHost());
            this.native = native;
            if (this.started) native.start();
            for (const [connectionId, force] of this.pending.splice(0)) native.enqueue(connectionId, force);
            return native;
        }
        return null;
    }

    /// Follow a new connection registry
    setRegistry(registry: Pick<ConnectionRegistry, 'connections'>): void {
        this.registry = registry;
        const native = this.nativeOf(registry);
        if (native == null) return;
        const ids: string[] = [];
        for (const [connectionId, conn] of registry.connections) {
            // A state without a Rust connection, e.g. of a test, has no catalog to load
            if (conn.native == null) continue;
            ids.push(connectionId);
            if (this.followed.get(connectionId) !== conn.native) {
                native.follow(connectionId, conn.native.connection);
                this.followed.set(connectionId, conn.native);
            }
        }
        for (const connectionId of [...this.followed.keys()]) {
            if (!registry.connections.has(connectionId)) this.followed.delete(connectionId);
        }
        native.observe(ids);
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
        const native = this.nativeOf(this.registry);
        if (native == null) return [0, Promise.reject(new Error(`couldn't find a connection with id ${connectionId}`))];
        const conn = this.registry.connections.get(connectionId);
        if (conn?.native != null && this.followed.get(connectionId) !== conn.native) {
            native.follow(connectionId, conn.native.connection);
            this.followed.set(connectionId, conn.native);
        }
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
        const running = this.registry.connections.get(connectionId)?.catalogUpdates.tasksRunning.get(taskId);
        return running == null ? null : { connectionId, cancellation: running.cancellation };
    }

    /// The host of the loader
    private createHost(): core.CatalogLoaderHost {
        const { logger } = this.deps;
        const dispatch = (connectionId: string, action: Parameters<DynamicConnectionDispatch>[1]) => this.deps.dispatchConnection(connectionId, action);
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
                this.tasks.set(taskId, { connectionId, cancellation });
                dispatch(connectionId, {
                    type: UPDATE_CATALOG,
                    value: [taskId, {
                        taskId,
                        taskVariant: variant === 0 ? CatalogUpdateVariant.FULL_CATALOG_REFRESH : CatalogUpdateVariant.RELATION_REFRESH,
                        status: CatalogUpdateTaskStatus.STARTED,
                        cancellation,
                        queries: [],
                        error: null,
                        startedAt: new Date(),
                        finishedAt: null,
                        touchedRelations: JSON.parse(relations) as RelationName[],
                    }],
                });
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
                        dispatch(connectionId, { type: CATALOG_UPDATE_SUCCEEDED, value: [taskId, outcome.catalogChanged] });
                        break;
                    case 'partiallySucceeded':
                        dispatch(connectionId, { type: CATALOG_UPDATE_PARTIALLY_SUCCEEDED, value: [taskId, new Error(outcome.error ?? '')] });
                        break;
                    case 'failed':
                        dispatch(connectionId, { type: CATALOG_UPDATE_FAILED, value: [taskId, new Error(outcome.error ?? '')] });
                        break;
                    case 'cancelled': {
                        const reason = task?.cancellation.signal.reason;
                        const error = reason instanceof Error ? reason : new DOMException(outcome.error ?? 'Catalog refresh was cancelled', 'AbortError');
                        dispatch(connectionId, { type: CATALOG_UPDATE_CANCELLED, value: [taskId, error] });
                        break;
                    }
                }
                // Announce the new catalog, the scripts that use the connection are analyzed again
                if (outcome.announces) this.deps.onCatalogDidUpdate?.(connectionId);
            },
            runQuery: async (requestId, connectionId, taskId, query) => {
                const execute = this.deps.execute;
                if (execute == null) throw new Error('the catalog loader has no query executor');
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
                    dispatch(connectionId, { type: CATALOG_UPDATE_REGISTER_QUERY, value: [taskId, queryId] });
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
                const conn = this.registry.connections.get(connectionId);
                if (conn?.details.type !== SALESFORCE_DATA_CLOUD_CONNECTOR) return null;
                const details = conn.details.value as SalesforceConnectionStateDetails;
                const coreAccessToken = details.proto.oauthState?.coreAccessToken;
                if (coreAccessToken == null) throw new Error('Salesforce core access token is missing');
                const metadata = await api.getDataCloudMetadata(coreAccessToken, dataSpace, new AbortController().signal);
                return JSON.stringify(metadata);
            },
            loadSpec: async extension => JSON.stringify(await loadClientFunctionSpec(extension)),
            catalogChanged: connectionId => this.deps.onCatalogDidUpdate?.(connectionId),
        };
    }
}
