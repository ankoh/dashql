import { DashQL, DashQLCatalog, Ptr } from './api.js';
import { DashQLQueryActions } from './query_history.js';
import type * as glue from './wasm/dashql_core.js';
import type {
    CatalogUpdateTaskStatus,
    CatalogUpdateVariant,
    ConnectionError,
    ConnectionOutcome,
    ConnectionRelationName,
    ConnectionTableName,
    ConnectionView,
    ConnectorType,
    JsonParams,
} from './wasm/dashql_core.js';

/// A connection with the history of its queries in the Rust runtime (`packages/dashql-core-runtime`, see
/// docs/wip/core_runtime.md). An action changes the connection and returns the effects that the host applies, e.g.
/// closing a channel or releasing a result table. Channels and result tables stay with the host, the connection knows
/// them by their ids. The state is read as views, the connection and every query change their revision with every
/// change.

const CONNECTION_TYPE = Symbol('CONNECTION_TYPE');
const CONNECTION_CATALOG_TYPE = Symbol('CONNECTION_CATALOG_TYPE');

/// The views of a connection, declared by the module (`packages/dashql-core-wasm/src/connection/view.rs`)
export type {
    ConnectionCatalogUpdates,
    ConnectionCatalogUpdateTask,
    ConnectionConnectorDetails,
    ConnectionDetailsView,
    ConnectionEffect,
    ConnectionError,
    ConnectionOAuthPkce,
    ConnectionOutcome,
    ConnectionRelationName,
    ConnectionSalesforceOAuthParams,
    ConnectionSalesforceOAuthState,
    ConnectionTableName,
    ConnectionTemporaryToken,
    ConnectionTrinoOAuthState,
    ConnectionView,
    JsonParams,
} from './wasm/dashql_core.js';
/// The connector, the status, the health and the catalog updates of a connection, numeric enums of the module
export { CatalogUpdateTaskStatus, CatalogUpdateVariant, ConnectionHealth, ConnectionStatus, ConnectorType } from './wasm/dashql_core.js';

/// The options of a new connection
export interface DashQLConnectionOptions {
    /// The params of the connector that the details of the setup start with, none without
    setupParams?: JsonParams | null;
    /// Does the connection belong to a committed workbook or was it connected once?
    active?: boolean;
    /// The params, the setup params by default
    params?: JsonParams | null;
    /// The draft of the params
    paramsDraft?: JsonParams | null;
}

type NativeConnection = glue.Connection;

const json = (value: unknown): string => JSON.stringify(value);

export class DashQLConnection extends DashQLQueryActions {
    public readonly ptr: Ptr<typeof CONNECTION_TYPE, NativeConnection>;
    /// The catalog handle, one per connection
    private catalogHandle: DashQLCatalog | null = null;

    public constructor(ptr: Ptr<typeof CONNECTION_TYPE, NativeConnection>) {
        super();
        this.ptr = ptr;
    }

    /// A connection of a connector with an empty catalog
    public static create(api: DashQL, connectionId: string, connector: ConnectorType, options: DashQLConnectionOptions = {}, now = Date.now()): DashQLConnection {
        const native = new api.bindings.Connection(
            connectionId,
            connector,
            options.setupParams,
            options.active ?? false,
            options.params,
            options.paramsDraft,
            now,
        );
        return new DashQLConnection(new Ptr(CONNECTION_TYPE, api, native));
    }

    /// A connection of the module that a service of the runtime created, e.g. the restore
    public static adopt(api: DashQL, native: NativeConnection): DashQLConnection {
        return new DashQLConnection(new Ptr(CONNECTION_TYPE, api, native));
    }

    /// Destroy the connection and its catalog handle. Other holders of the catalog keep it.
    public destroy(): void {
        this.catalogHandle?.destroy();
        this.catalogHandle = null;
        this.ptr.destroy();
    }

    private native(): NativeConnection {
        return this.ptr.assertNotNull();
    }

    protected queriesNative(): NativeConnection {
        return this.native();
    }

    protected queriesApi(): DashQL {
        return this.ptr.api;
    }

    // The connection

    public setDraft(draft: JsonParams, now = Date.now()): ConnectionOutcome {
        return this.native().setDraft(draft, now);
    }
    public discardDraft(now = Date.now()): ConnectionOutcome {
        return this.native().discardDraft(now);
    }
    public commitParams(params: JsonParams, now = Date.now()): ConnectionOutcome {
        return this.native().commitParams(params, now);
    }
    public rename(name: string, now = Date.now()): ConnectionOutcome {
        return this.native().rename(name, now);
    }
    public setQueryResultCaching(caching: boolean, now = Date.now()): ConnectionOutcome {
        return this.native().setQueryResultCaching(caching, now);
    }
    /// Stop the connection and drop its catalog and queries
    public delete(now = Date.now()): ConnectionOutcome {
        return this.native().delete(now);
    }
    /// Stop the connection and clear its catalog and queries
    public reset(now = Date.now()): ConnectionOutcome {
        return this.native().reset(now);
    }
    public switchConnectorType(connector: ConnectorType, now = Date.now()): ConnectionOutcome {
        return this.native().switchConnectorType(connector, now);
    }

    // The health check

    public healthCheckStarted(now = Date.now()): ConnectionOutcome {
        return this.native().healthCheckStarted(now);
    }
    public healthCheckCancelled(now = Date.now()): ConnectionOutcome {
        return this.native().healthCheckCancelled(now);
    }
    public healthCheckFailed(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().healthCheckFailed(error, now);
    }
    public healthCheckSucceeded(now = Date.now()): ConnectionOutcome {
        return this.native().healthCheckSucceeded(now);
    }

    // The catalog updates

    public relationsTouched(names: ConnectionTableName[], now = Date.now()): ConnectionOutcome {
        return this.native().relationsTouched(names, now);
    }
    /// A catalog update started: a full refresh or a lookup of relations
    public updateCatalog(taskId: number, variant: CatalogUpdateVariant, startedAt: number | null, touchedRelations: ConnectionRelationName[], now = Date.now()): ConnectionOutcome {
        return this.native().updateCatalog(taskId, variant, startedAt, touchedRelations, now);
    }
    public catalogUpdateRegisterQuery(taskId: number, queryId: number, now = Date.now()): ConnectionOutcome {
        return this.native().catalogUpdateRegisterQuery(taskId, queryId, now);
    }
    /// A catalog update finished with a final status
    public catalogUpdateFinished(taskId: number, status: CatalogUpdateTaskStatus, error: ConnectionError | null, now = Date.now()): ConnectionOutcome {
        return this.native().catalogUpdateFinished(taskId, status, error, now);
    }
    /// Restore the state of the catalog updates from the files of the catalog, null keeps a field. The connection
    /// changes its revision.
    public restoreCatalogUpdates(described: boolean | null, touchedRelations: ConnectionRelationName[] | null): void {
        this.native().restoreCatalogUpdates(described, touchedRelations);
    }

    // The setup of Hyper

    public hyperChannelSetupStarted(params: JsonParams, now = Date.now()): ConnectionOutcome {
        return this.native().hyperChannelSetupStarted(params, now);
    }
    public hyperChannelSetupCancelled(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().hyperChannelSetupCancelled(error, now);
    }
    public hyperChannelSetupFailed(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().hyperChannelSetupFailed(error, now);
    }
    public hyperChannelReady(channel: number, params: JsonParams, now = Date.now()): ConnectionOutcome {
        return this.native().hyperChannelReady(channel, params, now);
    }

    // The setup of Trino

    public trinoOAuthStarted(params: JsonParams, now = Date.now()): ConnectionOutcome {
        return this.native().trinoOAuthStarted(params, now);
    }
    public trinoOAuthCancelled(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().trinoOAuthCancelled(error, now);
    }
    public trinoOAuthFailed(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().trinoOAuthFailed(error, now);
    }
    public trinoGeneratingPkceChallenge(now = Date.now()): ConnectionOutcome {
        return this.native().trinoGeneratingPkceChallenge(now);
    }
    public trinoGeneratedPkceChallenge(value: string, verifier: string, now = Date.now()): ConnectionOutcome {
        return this.native().trinoGeneratedPkceChallenge(value, verifier, now);
    }
    public trinoOAuthBrowserOpened(now = Date.now()): ConnectionOutcome {
        return this.native().trinoOAuthBrowserOpened(now);
    }
    public trinoReceivedOAuthCode(token: string, createdAt: string, now = Date.now()): ConnectionOutcome {
        return this.native().trinoReceivedOAuthCode(token, createdAt, now);
    }
    public trinoRequestingAccessToken(now = Date.now()): ConnectionOutcome {
        return this.native().trinoRequestingAccessToken(now);
    }
    /// The access token arrived, it stays opaque JSON
    public trinoReceivedAccessToken(token: unknown, now = Date.now()): ConnectionOutcome {
        return this.native().trinoReceivedAccessToken(json(token), now);
    }
    public trinoChannelSetupStarted(params: JsonParams, now = Date.now()): ConnectionOutcome {
        return this.native().trinoChannelSetupStarted(params, now);
    }
    public trinoChannelSetupCancelled(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().trinoChannelSetupCancelled(error, now);
    }
    public trinoChannelSetupFailed(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().trinoChannelSetupFailed(error, now);
    }
    public trinoChannelReady(channel: number, now = Date.now()): ConnectionOutcome {
        return this.native().trinoChannelReady(channel, now);
    }

    // The setup of Salesforce and Database.com

    public salesforceSetupStarted(params: JsonParams, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceSetupStarted(params, now);
    }
    public salesforceSetupCancelled(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceSetupCancelled(error, now);
    }
    public salesforceSetupFailed(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceSetupFailed(error, now);
    }
    public salesforceGeneratingPkceChallenge(now = Date.now()): ConnectionOutcome {
        return this.native().salesforceGeneratingPkceChallenge(now);
    }
    public salesforceGeneratedPkceChallenge(value: string, verifier: string, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceGeneratedPkceChallenge(value, verifier, now);
    }
    public salesforceOAuthNativeLinkOpened(now = Date.now()): ConnectionOutcome {
        return this.native().salesforceOAuthNativeLinkOpened(now);
    }
    public salesforceOAuthWebWindowOpened(now = Date.now()): ConnectionOutcome {
        return this.native().salesforceOAuthWebWindowOpened(now);
    }
    public salesforceOAuthWebWindowClosed(now = Date.now()): ConnectionOutcome {
        return this.native().salesforceOAuthWebWindowClosed(now);
    }
    public salesforceReceivedCoreAuthCode(token: string, createdAt: string, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceReceivedCoreAuthCode(token, createdAt, now);
    }
    public salesforceRequestingCoreAuthToken(now = Date.now()): ConnectionOutcome {
        return this.native().salesforceRequestingCoreAuthToken(now);
    }
    /// The core access token arrived, it stays opaque JSON
    public salesforceReceivedCoreAuthToken(token: unknown, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceReceivedCoreAuthToken(json(token), now);
    }
    public salesforceReceivedCoreUserInfo(preferredUsername: string | null, email: string | null, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceReceivedCoreUserInfo(preferredUsername ?? undefined, email ?? undefined, now);
    }
    public salesforceRequestingDataCloudAccessToken(now = Date.now()): ConnectionOutcome {
        return this.native().salesforceRequestingDataCloudAccessToken(now);
    }
    /// The Data Cloud access token arrived, it stays opaque JSON
    public salesforceReceivedDataCloudAccessToken(token: unknown, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceReceivedDataCloudAccessToken(json(token), now);
    }
    public salesforceChannelSetupStarted(now = Date.now()): ConnectionOutcome {
        return this.native().salesforceChannelSetupStarted(now);
    }
    public salesforceChannelSetupCancelled(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceChannelSetupCancelled(error, now);
    }
    public salesforceChannelSetupFailed(error: ConnectionError, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceChannelSetupFailed(error, now);
    }
    public salesforceChannelReady(channel: number, now = Date.now()): ConnectionOutcome {
        return this.native().salesforceChannelReady(channel, now);
    }

    // Reading the state

    /// The revision of the connection, it changes with every change of the connection, not of its queries
    public revision(): number {
        return this.native().revision();
    }
    /// The revision of the queries, it changes with every change of a query
    public queriesRevision(): number {
        return this.native().queriesRevision();
    }
    /// The catalog of the connection. Every call returns the same handle, it shares the catalog with the connection
    /// and with the scripts that analyze with it.
    public get catalog(): DashQLCatalog {
        if (this.catalogHandle == null) {
            const native = this.native().catalog();
            // A catalog like the ones of `DashQL.createCatalog`, the symbol of their pointers is private to api.ts
            const ptr = new Ptr(CONNECTION_CATALOG_TYPE, this.ptr.api, native) as unknown as ConstructorParameters<typeof DashQLCatalog>[0];
            this.catalogHandle = new DashQLCatalog(ptr);
        }
        return this.catalogHandle;
    }
    /// The text of the script with the functions of the connection, null once it is deleted
    public functionScriptText(): string | null {
        return this.native().functionScriptText() ?? null;
    }
    public replaceFunctionScriptText(text: string): void {
        this.native().replaceFunctionScriptText(text);
    }
    /// The plain fields of the connection, the queries are read on their own
    public snapshot(): ConnectionView {
        return this.native().snapshot();
    }
}
