import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { DashQLShellCommand, DashQLShellCommandContext } from '../api.js';
import type { SalesforceLoginFormValues } from '../salesforce_login_dialog.js';
import type { SalesforceRemoteCatalogTable } from '../salesforce_remote_attachment.js';

export type SalesforceLoginForm = SalesforceLoginFormValues;

export interface SalesforceLoginAuthentication {
    readonly coreAccessToken: connection.SalesforceCoreAccessToken;
    readonly dataCloudAccessToken: connection.SalesforceDataCloudAccessToken;
    readonly coreUserInfo?: connection.SalesforceCoreUserInfo;
}

export interface SalesforceLoginCatalog {
    readonly tableCount: number;
    readonly columnCount: number;
    readonly tables: readonly SalesforceRemoteCatalogTable[];
    readonly functionsSQL: string;
}

export interface SalesforceLoginCommandDependencies {
    requestForm(signal?: AbortSignal): Promise<SalesforceLoginForm | null>;
    hasAlias(alias: string): boolean;
    authenticate(
        form: SalesforceLoginForm,
        signal?: AbortSignal,
        onProgress?: (message: string) => void,
    ): Promise<SalesforceLoginAuthentication>;
    resolveCatalog(
        authentication: SalesforceLoginAuthentication,
        signal?: AbortSignal,
        onProgress?: (message: string) => void,
    ): Promise<SalesforceLoginCatalog>;
    attach(
        alias: string,
        authentication: SalesforceLoginAuthentication,
        catalog: SalesforceLoginCatalog,
        signal?: AbortSignal,
        onProgress?: (message: string) => void,
    ): Promise<void>;
    onSuccess?(alias: string, catalog: SalesforceLoginCatalog): void;
    onError?(error: unknown): void;
}

export type SalesforceLoginCommandContext = DashQLShellCommandContext;

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
    return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

export function createLoginCommand(dependencies: SalesforceLoginCommandDependencies): DashQLShellCommand {
    return [
        'login',
        'Authenticate with Salesforce',
        async (args, context) => {
            if (args.length !== 0) throw new Error('usage: .login');
            const { signal, onProgress } = context;
            let form: SalesforceLoginForm | null = null;

            try {
                form = await dependencies.requestForm(signal);
                if (form == null || signal?.aborted) return;
                const alias = form.alias.trim();
                if (alias.length === 0) throw new Error('Salesforce alias is required');
                if (dependencies.hasAlias(alias)) {
                    form.oauthPopup?.close();
                    throw new Error(`Salesforce alias already exists: ${alias}`);
                }

                const operationSignal = form.abortSignal ?? signal;
                onProgress?.('Authenticating with Salesforce');
                const authentication = await dependencies.authenticate(form, operationSignal, onProgress);
                operationSignal?.throwIfAborted();

                onProgress?.('Resolving optimized Salesforce catalog');
                const catalog = await dependencies.resolveCatalog(authentication, operationSignal, onProgress);
                operationSignal?.throwIfAborted();

                onProgress?.(`Attaching Salesforce connection as ${alias}`);
                await dependencies.attach(alias, authentication, catalog, operationSignal, onProgress);
                operationSignal?.throwIfAborted();

                dependencies.onSuccess?.(alias, catalog);
                return `Attached Salesforce as ${alias}: ${catalog.tableCount} tables, ${catalog.columnCount} columns`;
            } catch (error) {
                if (form?.oauthPopup && !form.oauthPopup.closed) form.oauthPopup.close();
                if (isAbortError(error, form?.abortSignal ?? signal)) return;
                dependencies.onError?.(error);
                throw error;
            }
        },
    ];
}
