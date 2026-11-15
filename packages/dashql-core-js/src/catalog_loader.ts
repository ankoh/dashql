import { DashQL, Ptr } from './api.js';
import type { ConnectionRelationName } from './connection.js';
import type * as glue from './wasm/dashql_core.js';

/// The catalog loader of the Rust runtime (`packages/dashql-core-runtime/src/catalog_loader/service.rs`, see
/// docs/wip/core_runtime.md): it follows the connections of a runtime, schedules the updates of their catalogs,
/// runs them over the query executor and the HTTP client of the host and publishes into their catalogs. The host applies
/// the start and the end of an update to the connection and keeps its cancellation.

export type { CatalogLoaderHost, CatalogLoaderQuery, CatalogLoaderOutcome } from './wasm/dashql_core.js';

const CATALOG_LOADER_TYPE = Symbol('CATALOG_LOADER_TYPE');

export class DashQLCatalogLoader {
    public readonly ptr: Ptr<typeof CATALOG_LOADER_TYPE, glue.CatalogLoader>;

    public constructor(ptr: Ptr<typeof CATALOG_LOADER_TYPE, glue.CatalogLoader>) {
        this.ptr = ptr;
    }

    /// A loader on a host, it schedules once it is started
    public static create(api: DashQL, host: glue.CatalogLoaderHost): DashQLCatalogLoader {
        return new DashQLCatalogLoader(new Ptr(CATALOG_LOADER_TYPE, api, new api.bindings.CatalogLoader(host)));
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    /// Follow the connections of a runtime in their order, e.g. again after its list of connections changed
    public follow(runtime: glue.Runtime): void {
        this.ptr.assertNotNull().follow(runtime);
    }

    /// Request a refresh of the catalog of a connection, a forced one supersedes a running update
    public enqueue(connectionId: string, force: boolean): void {
        this.ptr.assertNotNull().enqueue(connectionId, force);
    }

    /// The cancellation of an update fired, it ends as cancelled with the reason
    public cancel(taskId: number, reason: string): void {
        this.ptr.assertNotNull().cancel(taskId, reason);
    }

    /// Start an update outside of the schedule, of the relations or of the whole catalog. The promise settles once it
    /// ended and rejects only if it couldn't start.
    public update(connectionId: string, relations: ConnectionRelationName[] | null): [number, Promise<void>] {
        const started = this.ptr.assertNotNull().update(connectionId, relations == null ? undefined : JSON.stringify(relations)) as {
            taskId: number;
            done: Promise<void>;
        };
        return [started.taskId, started.done];
    }

    /// Start scheduling
    public start(): void {
        this.ptr.assertNotNull().start();
    }

    /// Stop scheduling, running updates finish
    public stop(): void {
        this.ptr.assertNotNull().stop();
    }
}
