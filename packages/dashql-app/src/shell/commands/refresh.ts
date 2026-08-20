import type { DashQLShellCommand } from '../api.js';
import type { SalesforceLoginAuthentication } from './login.js';
import type { SalesforceRemoteCatalog } from '../salesforce_remote_attachment.js';

export interface SalesforceRefreshCatalog extends SalesforceRemoteCatalog {
    readonly tableCount: number;
    readonly columnCount: number;
    readonly metadataStatus: string;
}

export interface SalesforceRefreshCommandDependencies {
    getAliases(): readonly string[];
    getAuthentication(alias: string): SalesforceLoginAuthentication | undefined;
    resolveCatalog(
        alias: string,
        authentication: SalesforceLoginAuthentication,
        signal?: AbortSignal,
        onProgress?: (message: string) => void,
    ): Promise<SalesforceRefreshCatalog>;
    refreshCatalog(alias: string, catalog: SalesforceRefreshCatalog, signal?: AbortSignal): Promise<void>;
}

export function createRefreshCommand(dependencies: SalesforceRefreshCommandDependencies): DashQLShellCommand {
    return [
        'refresh',
        'Refresh Salesforce catalogs: all or one alias',
        async (args, context) => {
            if (args.length > 1) throw new Error('usage: .refresh [alias]');
            const aliases = args.length === 1 ? [args[0]] : [...dependencies.getAliases()];
            if (aliases.length === 0) throw new Error('No Salesforce connections are attached');

            const summaries: string[] = [];
            for (const alias of aliases) {
                const authentication = dependencies.getAuthentication(alias);
                if (authentication == null) throw new Error(`Salesforce alias not found: ${alias}`);
                context.onProgress?.(`Refreshing Salesforce catalog for ${alias}`);
                const catalog = await dependencies.resolveCatalog(
                    alias,
                    authentication,
                    context.signal,
                    context.onProgress,
                );
                context.signal?.throwIfAborted();
                await dependencies.refreshCatalog(alias, catalog, context.signal);
                context.signal?.throwIfAborted();
                summaries.push(
                    `${catalog.metadataStatus}\r\n` +
                    `Refreshed ${alias}: ${catalog.tableCount} tables, ${catalog.columnCount} columns`,
                );
            }
            return summaries.join('\r\n');
        },
    ];
}
