import type { EmbeddedConnection } from '../platform/database/embedded_database.js';
import { generateSchemaSQL } from '../app/notebook/connections/catalog_sql_generator.js';
import type { LoggerLike } from '../platform/logger/logger.js';
import type { DashQLShell } from './api.js';

export const SALESFORCE_CATALOG_RANK = 100;
const ENDPOINT_KEY_PREFIX = 'salesforce-';
const HYPER_REMOTE_ENDPOINTS_SETTING = 'global.hyper_remote_endpoints';
const HYPER_REMOTE_GATE = 'global.experimental_dbregistry_hyper_remote';
const LOG_CTX = 'salesforce_remote_attachment';

export interface SalesforceRemoteDataCloudToken {
    readonly instanceUrl?: string | null;
    readonly jwt?: {
        readonly raw?: string | null;
        readonly payload?: {
            readonly audienceTenantId?: string | null;
        } | null;
    } | null;
}

export interface SalesforceRemoteCatalogColumn {
    readonly name: string;
    readonly ordinalPosition: number;
    readonly dataType?: string | null;
}

export interface SalesforceRemoteCatalogTable {
    readonly name: string;
    readonly columns: readonly SalesforceRemoteCatalogColumn[];
}

export interface SalesforceRemoteCatalog {
    readonly tables: readonly SalesforceRemoteCatalogTable[];
    readonly functionsSQL?: string;
}

export interface SalesforceRemoteAttachment {
    readonly alias: string;
    readonly tableCount: number;
    readonly columnCount: number;
}

export interface SalesforceRemoteAttachmentDependencies {
    loadPrefetchedFunctionSql(signal?: AbortSignal): Promise<string>;
    createEndpointKey?(alias: string): string;
    onStage?(stage: SalesforceRemoteAttachmentStage): void;
    logger?: LoggerLike;
}

export type SalesforceRemoteAttachmentStage =
    | 'CONFIGURING_ENDPOINT'
    | 'ENABLING_REMOTE_DATABASES'
    | 'ATTACHING_DATABASE'
    | 'LOADING_CATALOG';

interface HyperRemoteEndpointConfig {
    readonly connection: {
        readonly host: string;
        readonly port: number;
    };
    readonly tenant: string;
    readonly token: string;
}

export function quoteSqlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

export function quoteSqlIdentifier(value: string): string {
    if (value.length === 0 || value.includes('\0')) throw new Error('SQL identifier must not be empty or contain NUL');
    return `"${value.replace(/"/g, '""')}"`;
}

function defaultCreateEndpointKey(alias: string): string {
    return `${ENDPOINT_KEY_PREFIX}${alias.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
}

function readEndpoint(token: SalesforceRemoteDataCloudToken): HyperRemoteEndpointConfig {
    if (!token.instanceUrl) throw new Error('Salesforce Data Cloud token is missing instanceUrl');
    if (!token.jwt?.payload?.audienceTenantId) {
        throw new Error('Salesforce Data Cloud token is missing audienceTenantId');
    }
    if (!token.jwt.raw) throw new Error('Salesforce Data Cloud token is missing raw JWT');

    const url = new URL(token.instanceUrl);
    if (url.protocol !== 'https:') throw new Error('Salesforce Data Cloud endpoint must use HTTPS');
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('Salesforce Data Cloud endpoint URL must not contain credentials, query, or fragment');
    }
    const port = url.port || '443';
    return {
        connection: {
            host: `${url.protocol}//${url.hostname}`,
            port: Number(port),
        },
        tenant: token.jwt.payload.audienceTenantId,
        token: token.jwt.raw,
    };
}

function summarizeEndpoint(endpoint: HyperRemoteEndpointConfig): Record<string, string> {
    return {
        hostOrigin: endpoint.connection.host,
        port: endpoint.connection.port.toString(),
        tenantPresent: (endpoint.tenant.length > 0).toString(),
        tokenPresent: (endpoint.token.length > 0).toString(),
        tokenPartCount: endpoint.token.split('.').length.toString(),
    };
}

export class SalesforceRemoteAttachmentManager {
    private readonly aliases = new Set<string>();
    private readonly endpoints = new Map<string, HyperRemoteEndpointConfig>();
    private functionCatalogLoaded = false;
    private gateEnabled = false;

    constructor(
        private readonly connection: EmbeddedConnection,
        private readonly shell: Pick<DashQLShell, 'loadCatalogScript'>,
        private readonly dependencies: SalesforceRemoteAttachmentDependencies,
    ) {}

    hasAlias(alias: string): boolean {
        return this.aliases.has(alias.toLowerCase());
    }

    async attach(
        alias: string,
        token: SalesforceRemoteDataCloudToken,
        catalog: SalesforceRemoteCatalog,
        signal?: AbortSignal,
    ): Promise<SalesforceRemoteAttachment> {
        signal?.throwIfAborted();
        const normalizedAlias = alias.toLowerCase();
        if (this.aliases.has(normalizedAlias)) throw new Error(`Salesforce alias already exists: ${alias}`);

        const endpointKey = (this.dependencies.createEndpointKey ?? defaultCreateEndpointKey)(alias);
        if (this.endpoints.has(endpointKey)) throw new Error(`Salesforce endpoint key already exists: ${endpointKey}`);
        const endpoint = readEndpoint(token);
        const nextEndpoints = new Map(this.endpoints);
        nextEndpoints.set(endpointKey, endpoint);
        const previousSetting = this.serializeEndpoints(this.endpoints);
        const nextSetting = this.serializeEndpoints(nextEndpoints);
        const quotedAlias = quoteSqlIdentifier(alias);
        let settingUpdated = false;
        const enabledGate = !this.gateEnabled;
        let attached = false;
        let committed = false;
        const attachStartedAt = performance.now();

        this.logInfo('Starting Salesforce database attachment', {
            alias,
            endpointKey,
            ...summarizeEndpoint(endpoint),
            tableCount: catalog.tables.length.toString(),
            columnCount: catalog.tables.reduce((count, table) => count + table.columns.length, 0).toString(),
        });

        try {
            this.dependencies.onStage?.('CONFIGURING_ENDPOINT');
            await this.execute(
                `SET ${HYPER_REMOTE_ENDPOINTS_SETTING} = ${quoteSqlString(nextSetting)}`,
                'configure-endpoint',
                { alias, endpointKey, endpointCount: nextEndpoints.size.toString() },
                signal,
            );
            settingUpdated = true;
            this.dependencies.onStage?.('ENABLING_REMOTE_DATABASES');
            await this.execute(
                `SET ${HYPER_REMOTE_GATE} = true`,
                'enable-remote-databases',
                { alias, endpointKey },
                signal,
            );
            this.dependencies.onStage?.('ATTACHING_DATABASE');
            await this.execute(
                `ATTACH DATABASE ${quoteSqlIdentifier(`hyper.remote://${endpointKey}`)} AS ${quotedAlias}`,
                'attach-database',
                { alias, endpointKey },
                signal,
            );
            attached = true;

            this.dependencies.onStage?.('LOADING_CATALOG');
            const catalogStartedAt = performance.now();
            this.logInfo('Starting Salesforce catalog registration', { alias, endpointKey });
            if (!this.functionCatalogLoaded) {
                const functionSqlStartedAt = performance.now();
                this.logInfo('Starting Salesforce function catalog resolution', {
                    alias,
                    endpointKey,
                    source: catalog.functionsSQL == null ? 'prefetched-fetch' : 'resolved-catalog',
                });
                const functionSql = catalog.functionsSQL ?? await this.dependencies.loadPrefetchedFunctionSql(signal);
                this.logInfo('Completed Salesforce function catalog resolution', {
                    alias,
                    endpointKey,
                    elapsedMs: (performance.now() - functionSqlStartedAt).toFixed(0),
                    scriptChars: functionSql.length.toString(),
                });
                signal?.throwIfAborted();
                const schemaSqlStartedAt = performance.now();
                this.logInfo('Starting Salesforce relation catalog generation', { alias, endpointKey });
                const tables = new Map(catalog.tables.map(table => [table.name, [...table.columns]]));
                const catalogSql = generateSchemaSQL(alias, 'public', tables);
                this.logInfo('Completed Salesforce relation catalog generation', {
                    alias,
                    endpointKey,
                    elapsedMs: (performance.now() - schemaSqlStartedAt).toFixed(0),
                    scriptChars: catalogSql.length.toString(),
                });
                this.logInfo('Starting Salesforce function catalog load', {
                    alias,
                    endpointKey,
                    scriptChars: functionSql.length.toString(),
                });
                this.shell.loadCatalogScript(functionSql, SALESFORCE_CATALOG_RANK);
                this.logInfo('Completed Salesforce function catalog load', { alias, endpointKey });
                this.logInfo('Starting Salesforce relation catalog load', {
                    alias,
                    endpointKey,
                    scriptChars: catalogSql.length.toString(),
                });
                this.shell.loadCatalogScript(catalogSql, SALESFORCE_CATALOG_RANK);
                this.logInfo('Completed Salesforce relation catalog load', { alias, endpointKey });
                this.functionCatalogLoaded = true;
            } else {
                const schemaSqlStartedAt = performance.now();
                this.logInfo('Starting Salesforce relation catalog generation', { alias, endpointKey });
                const tables = new Map(catalog.tables.map(table => [table.name, [...table.columns]]));
                const catalogSql = generateSchemaSQL(alias, 'public', tables);
                this.logInfo('Completed Salesforce relation catalog generation', {
                    alias,
                    endpointKey,
                    elapsedMs: (performance.now() - schemaSqlStartedAt).toFixed(0),
                    scriptChars: catalogSql.length.toString(),
                });
                signal?.throwIfAborted();
                this.logInfo('Starting Salesforce relation catalog load', {
                    alias,
                    endpointKey,
                    scriptChars: catalogSql.length.toString(),
                });
                this.shell.loadCatalogScript(catalogSql, SALESFORCE_CATALOG_RANK);
                this.logInfo('Completed Salesforce relation catalog load', { alias, endpointKey });
            }
            this.logInfo('Completed Salesforce catalog registration', {
                alias,
                endpointKey,
                elapsedMs: (performance.now() - catalogStartedAt).toFixed(0),
            });

            // Catalog installation is the commit point. Do not turn a completed attachment into
            // a detached database merely because cancellation raced with the final synchronous load.
            this.endpoints.set(endpointKey, endpoint);
            this.aliases.add(normalizedAlias);
            this.gateEnabled = true;
            committed = true;
            this.logInfo('Completed Salesforce database attachment', {
                alias,
                endpointKey,
                elapsedMs: (performance.now() - attachStartedAt).toFixed(0),
            });
            return {
                alias,
                tableCount: catalog.tables.length,
                columnCount: catalog.tables.reduce((count, table) => count + table.columns.length, 0),
            };
        } catch (error) {
            if (committed) throw error;
            this.logError('Salesforce database attachment failed', {
                alias,
                endpointKey,
                elapsedMs: (performance.now() - attachStartedAt).toFixed(0),
                errorType: error instanceof Error ? error.name : typeof error,
            });
            if (attached) {
                await this.executeBestEffort(`DETACH ${quotedAlias}`, 'rollback-detach', { alias, endpointKey });
            }
            if (settingUpdated) {
                await this.executeBestEffort(
                    `SET ${HYPER_REMOTE_ENDPOINTS_SETTING} = ${quoteSqlString(previousSetting)}`,
                    'rollback-endpoint',
                    { alias, endpointKey, endpointCount: this.endpoints.size.toString() },
                );
            }
            if (enabledGate) {
                await this.executeBestEffort(
                    `SET ${HYPER_REMOTE_GATE} = false`,
                    'rollback-remote-databases',
                    { alias, endpointKey },
                );
            }
            throw error;
        }
    }

    private serializeEndpoints(endpoints: ReadonlyMap<string, HyperRemoteEndpointConfig>): string {
        return JSON.stringify(Object.fromEntries(endpoints));
    }

    private async execute(
        sql: string,
        operation: string,
        keyValues: Record<string, string>,
        signal?: AbortSignal,
    ): Promise<void> {
        signal?.throwIfAborted();
        const startedAt = performance.now();
        this.logInfo('Starting Salesforce database attach operation', { ...keyValues, operation });
        try {
            await this.connection.queryArrowIPC(sql, signal);
            signal?.throwIfAborted();
            this.logInfo('Completed Salesforce database attach operation', {
                ...keyValues,
                operation,
                elapsedMs: (performance.now() - startedAt).toFixed(0),
            });
        } catch (error) {
            this.logError('Salesforce database attach operation failed', {
                ...keyValues,
                operation,
                elapsedMs: (performance.now() - startedAt).toFixed(0),
                errorType: error instanceof Error ? error.name : typeof error,
            });
            throw error;
        }
    }

    private async executeBestEffort(
        sql: string,
        operation: string,
        keyValues: Record<string, string>,
    ): Promise<void> {
        const startedAt = performance.now();
        this.logInfo('Starting Salesforce database attach rollback', { ...keyValues, operation });
        try {
            await this.connection.queryArrowIPC(sql);
            this.logInfo('Completed Salesforce database attach rollback', {
                ...keyValues,
                operation,
                elapsedMs: (performance.now() - startedAt).toFixed(0),
            });
        } catch (error) {
            this.logError('Salesforce database attach rollback failed', {
                ...keyValues,
                operation,
                elapsedMs: (performance.now() - startedAt).toFixed(0),
                errorType: error instanceof Error ? error.name : typeof error,
            });
            // Preserve the original failure while attempting to restore runtime state.
        }
    }

    private logInfo(message: string, keyValues: Record<string, string>): void {
        this.dependencies.logger?.info(message, keyValues, LOG_CTX, true);
    }

    private logError(message: string, keyValues: Record<string, string>): void {
        this.dependencies.logger?.error(message, keyValues, LOG_CTX, true);
    }
}
