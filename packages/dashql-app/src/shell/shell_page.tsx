import * as React from 'react';

import * as connectionTypes from '@ankoh/dashql-jsonschema/connection.js';

import type { EmbeddedConnection } from '../platform/database/embedded_database.js';
import { useEmbeddedDatabaseSetup } from '../platform/database/embedded_database_provider.js';
import { stringifyError } from '../platform/logger/logger.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { createDashQLShell, type DashQLShell, type DashQLShellCommand } from './api.js';
import type { BrowserShellController } from './browser_shell.js';
import { analyzeTable } from '../compute/computation_logic.js';
import { useComputationRegistry } from '../compute/computation_registry.js';
import { ShellQueryResultOverlay } from '../app/notebook/shell/shell_query_result_overlay.js';
import { createEmbeddedDatabaseShellEnvironment } from './embedded_database_shell_environment.js';
import { createLoginCommand, type SalesforceLoginAuthentication } from './commands/login.js';
import { createRefreshCommand } from './commands/refresh.js';
import { SalesforceLoginHistoryStore } from './salesforce_login_history.js';
import { examplesCommand } from './commands/examples.js';
import { useShellConnection } from './shell_connection.js';
import { createShellOutputCommand, type ShellOutputMode } from './shell_result.js';
import { createShellFilesCommand, ShellFileRegistry } from './shell_files.js';
import { createDatabaseCommand } from './commands/database.js';
import { OPFSPersistentDatabaseRegistry } from './persistent_database_registry.js';
import { useFileDownloader } from '../platform/file/file_downloader_provider.js';
import { useSalesforceLoginDialog } from './salesforce_login_dialog.js';
import { SalesforceRemoteAttachmentManager } from './salesforce_remote_attachment.js';
import {
    formatSalesforceMetadataProgress,
    SalesforceApiClient,
    type SalesforceMetadataProgress,
} from '../app/notebook/connections/salesforce/salesforce_api_client.js';
import { authenticateSalesforce } from '../app/notebook/connections/salesforce/salesforce_authentication.js';
import { resolveSalesforceCatalog } from '../app/notebook/connections/salesforce/salesforce_catalog_update.js';
import { fetchPrefetchedHyperFunctions } from '../app/notebook/connections/prefetched_hyper_functions.js';
import { useHttpClient } from '../platform/http/http_client_provider.js';
import { usePlatformEventListener } from '../platform/events/event_listener_provider.js';
import { usePlatformType } from '../platform/platform_type.js';
import { useAppConfig } from '../app/config/app_config.js';
import { useShellQueryResult } from './use_shell_query_result.js';
import * as styles from './shell_page.module.css';

const LOG_CTX = 'standalone_shell';

interface ShellPageProps {
    onEngineVersion: (version: string) => void;
}

function formatInstantiationProgress(bytesLoaded: number, bytesTotal: number): string {
    if (bytesTotal <= 0) return `Loading ${Math.round(bytesLoaded / 1000)} kB`;
    const blocks = Math.max(0, Math.min(10, Math.floor(bytesLoaded / bytesTotal * 10)));
    return `Loading [${'#'.repeat(blocks)}${'-'.repeat(10 - blocks)}]`;
}

export const ShellPage: React.FC<ShellPageProps> = (props: ShellPageProps) => {
    const logger = useLogger();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const { setConnected, queryExecutions } = useShellConnection();
    const [, dispatchComputation] = useComputationRegistry();
    const fileDownloader = useFileDownloader();
    const httpClient = useHttpClient();
    const appEvents = usePlatformEventListener();
    const platformType = usePlatformType();
    const appConfig = useAppConfig();
    const loginHistoryRef = React.useRef(new SalesforceLoginHistoryStore());
    const attachmentManagerRef = React.useRef<SalesforceRemoteAttachmentManager | null>(null);
    const { controller: loginDialog, dialog } = useSalesforceLoginDialog({
        hasAlias: (alias: string) => attachmentManagerRef.current?.hasAlias(alias) ?? false,
        loadHistory: () => loginHistoryRef.current.load(),
        deleteHistoryEntry: organizationId => loginHistoryRef.current.delete(organizationId),
    });
    const containerRef = React.useRef<HTMLDivElement>(null);
    const fileRegistryRef = React.useRef(new ShellFileRegistry());
    const databaseRegistryRef = React.useRef(new OPFSPersistentDatabaseRegistry());
    const outputModeRef = React.useRef<ShellOutputMode>('auto');
    const terminalColumnsRef = React.useRef(100);
    const [status, setStatus] = React.useState('Instantiating database');
    const { resultQuery, showResultQuery, closeResultQuery } = useShellQueryResult(queryExecutions);

    React.useEffect(() => {
        if (containerRef.current == null) return;

        let cancelled = false;
        let connection: EmbeddedConnection | null = null;
        let shell: DashQLShell | null = null;
        let controller: BrowserShellController | null = null;

        const setup = async () => {
            const database = await setupEmbeddedDatabase(LOG_CTX, progress => {
                if (!cancelled) {
                    setStatus(`Instantiating database: ${formatInstantiationProgress(progress.bytesLoaded, progress.bytesTotal)}`);
                }
            });
            void database.getVersion()
                .then(version => {
                    if (!cancelled) props.onEngineVersion(version);
                })
                .catch(error => {
                    logger.warn('Failed to load engine version', { error: stringifyError(error) }, LOG_CTX);
                });
            const nextConnection = await database.connect();
            if (cancelled) {
                await nextConnection.close();
                return;
            }
            connection = nextConnection;
            setConnected(true);

            setStatus('Instantiating shell');
            const getOutputMode = () => outputModeRef.current;
            let attachmentManager: SalesforceRemoteAttachmentManager;
            const authentications = new Map<string, SalesforceLoginAuthentication>();
            const loginCommand = createLoginCommand({
                requestForm: loginDialog.request,
                hasAlias: alias => attachmentManager?.hasAlias(alias) ?? false,
                authenticate: async (form, signal, onProgress) => {
                    if (!httpClient) throw new Error('HTTP client is not ready');
                    const oauthRedirect = appConfig?.connectors?.salesforce?.auth?.oauthRedirect;
                    if (!oauthRedirect) throw new Error('Salesforce OAuth redirect is not configured');
                    const abortSignal = signal ?? new AbortController().signal;
                    const params: connectionTypes.SalesforceConnectionParams = {
                        hyperProtocol: 'WASM',
                        instanceUrl: form.instanceUrl,
                        appConsumerKey: form.appConsumerKey,
                        appConsumerSecret: '',
                        login: form.loginHint,
                    };
                    return await authenticateSalesforce({
                        logger,
                        params,
                        authConfig: { oauthRedirect },
                        platformType,
                        apiClient: new SalesforceApiClient(logger, httpClient),
                        appEvents,
                        forceReLogin: appConfig?.settings?.forceReLogin ?? false,
                        abortSignal,
                        oauthPopup: form.oauthPopup,
                        onProgress: progress => {
                            const messages: Partial<Record<typeof progress.stage, string>> = {
                                GENERATING_PKCE_CHALLENGE: 'Preparing secure Salesforce login',
                                OAUTH_WEB_WINDOW_OPENED: 'Waiting for Salesforce authorization',
                                REQUESTING_CORE_AUTH_TOKEN: 'Exchanging Salesforce authorization code',
                                REQUESTING_DATA_CLOUD_ACCESS_TOKEN: 'Requesting Data Cloud credentials',
                            };
                            const message = messages[progress.stage];
                            if (message) {
                                onProgress?.(message);
                                loginDialog.update({ status: message });
                            }
                            if (progress.stage === 'RECEIVED_CORE_AUTH_TOKEN') {
                                loginDialog.update({
                                    status: 'Received Core access token',
                                    coreAccessToken: progress.coreAccessToken,
                                });
                            } else if (progress.stage === 'RECEIVED_CORE_USER_INFO') {
                                loginDialog.update({
                                    login: progress.coreUserInfo.preferredUsername ?? progress.coreUserInfo.email ?? '',
                                });
                            } else if (progress.stage === 'RECEIVED_DATA_CLOUD_ACCESS_TOKEN') {
                                loginDialog.update({
                                    status: 'Received Data Cloud access token',
                                    dataCloudAccessToken: progress.dataCloudAccessToken,
                                });
                            }
                        },
                    });
                },
                attach: async (alias, authentication, signal) => {
                    loginDialog.update({ status: `Attaching database as ${alias}` });
                    await attachmentManager.attach(alias, authentication.dataCloudAccessToken, signal);
                    authentications.set(alias.toLowerCase(), authentication);
                },
                onSuccess: async (form, authentication) => {
                    const organizationId = authentication.coreUserInfo?.organizationId
                        ?? authentication.dataCloudAccessToken.jwt.payload.orgId;
                    if (organizationId) {
                        try {
                            await loginHistoryRef.current.record({
                                organizationId,
                                name: form.alias,
                                instanceUrl: authentication.coreAccessToken.instanceUrl ?? form.instanceUrl,
                                appConsumerKey: form.appConsumerKey,
                                loginHint: authentication.coreUserInfo?.preferredUsername
                                    ?? authentication.coreUserInfo?.email,
                            });
                        } catch (error) {
                            logger.warn('Failed to persist Salesforce login history', {
                                error: stringifyError(error),
                            }, LOG_CTX);
                        }
                    } else {
                        logger.warn('Salesforce login did not return an organization ID; history was not updated', {}, LOG_CTX);
                    }
                    loginDialog.succeed(`Attached ${form.alias}`);
                },
                onError: error => {
                    loginDialog.fail(stringifyError(error));
                    return 'retry';
                },
            });
            const refreshCommand = createRefreshCommand({
                getAliases: () => attachmentManager?.getAliases() ?? [],
                getAuthentication: alias => authentications.get(alias.toLowerCase()),
                resolveCatalog: async (alias, authentication, signal, onProgress) => {
                    if (!httpClient) throw new Error('HTTP client is not ready');
                    onProgress?.(`Fetching Salesforce catalog metadata for ${alias}`);
                    const metadataProgress = new Map<string, SalesforceMetadataProgress>();
                    const resolved = await resolveSalesforceCatalog(
                        logger,
                        authentication.coreAccessToken,
                        authentication.dataCloudAccessToken,
                        new SalesforceApiClient(logger, httpClient),
                        signal ?? new AbortController().signal,
                        progress => {
                            metadataProgress.set(progress.collection, progress);
                            onProgress?.(formatSalesforceMetadataProgress(metadataProgress));
                        },
                    );
                    return {
                        tableCount: resolved.tableCount,
                        columnCount: resolved.columnCount,
                        metadataStatus: formatSalesforceMetadataProgress(metadataProgress),
                        functionsSQL: resolved.functionsSQL,
                        tables: Array.from(resolved.tables, ([name, columns]) => ({ name, columns })),
                    };
                },
                refreshCatalog: (alias, catalog, signal) => attachmentManager.refreshCatalog(alias, catalog, signal),
            });
            const commands: DashQLShellCommand[] = [
                examplesCommand,
                loginCommand,
                refreshCommand,
                createShellOutputCommand(getOutputMode, mode => { outputModeRef.current = mode; }),
                createShellFilesCommand(fileRegistryRef.current, fileDownloader),
            ];
            const databaseCommand = createDatabaseCommand(
                database,
                connection,
                databaseRegistryRef.current,
                fileDownloader,
            );
            if (databaseCommand != null) commands.push(databaseCommand);
            const nextShell = await createDashQLShell({
                environment: createEmbeddedDatabaseShellEnvironment(connection, queryExecutions, {
                    getOutputMode,
                    getTerminalColumns: () => terminalColumnsRef.current,
                    prepareResult: (queryId, table) => analyzeTable(
                        queryId,
                        table,
                        dispatchComputation,
                        database,
                        logger,
                    ),
                }),
                trackSessionRelations: true,
                autoQualifyNonDefaultDatabaseTables: true,
                commands,
                onProgress: progress => {
                    if (!cancelled) {
                        setStatus(`Instantiating shell: ${formatInstantiationProgress(progress.bytesLoaded, progress.bytesTotal)}`);
                    }
                },
            });
            if (cancelled || containerRef.current == null) {
                nextShell.destroy();
                return;
            }
            shell = nextShell;
            attachmentManager = new SalesforceRemoteAttachmentManager(connection, shell, {
                loadPrefetchedFunctionSql: fetchPrefetchedHyperFunctions,
                logger,
                onStage: stage => {
                    const messages = {
                        CONFIGURING_ENDPOINT: 'Configuring Data Cloud endpoint',
                        ENABLING_REMOTE_DATABASES: 'Enabling remote databases',
                        ATTACHING_DATABASE: 'Attaching Data Cloud database',
                        LOADING_CATALOG: 'Loading Salesforce catalog',
                    } as const;
                    loginDialog.update({ status: messages[stage] });
                },
            });
            attachmentManagerRef.current = attachmentManager;

            const { embedDashQLShell } = await import('./browser_shell.js');
            if (cancelled || containerRef.current == null) return;
            const nextController = await embedDashQLShell({
                container: containerRef.current,
                shell,
                greeter: [
                    'HyperDB Web Shell',
                    'This is an embedded version of the Hyper Database Engine.',
                    'Enter .help for usage hints.'
                ],
                prompt: 'hyperdb> ',
                inputAriaLabel: 'HyperDB shell input',
                onQueryResult: showResultQuery,
                onTerminalResize: columns => { terminalColumnsRef.current = columns; },
            });
            if (cancelled) {
                nextController.dispose();
                return;
            }
            controller = nextController;
            setStatus('');
        };

        void setup().catch(error => {
            if (cancelled) return;
            const message = `Failed to load shell: ${stringifyError(error)}`;
            logger.error(message, {}, LOG_CTX);
            setStatus(message);
        });

        return () => {
            cancelled = true;
            controller?.dispose();
            shell?.destroy();
            attachmentManagerRef.current = null;
            setConnected(false);
            void connection?.close();
        };
    }, [appConfig, appEvents, dispatchComputation, fileDownloader, httpClient, logger, loginDialog, platformType, props.onEngineVersion, queryExecutions, setConnected, setupEmbeddedDatabase, showResultQuery]);

    return (
        <main className={styles.page} aria-label="HyperDB Shell">
            <div className={styles.terminal}>
                <div ref={containerRef} className={styles.terminalHost} />
            </div>
            {status && (
                <div className={styles.status} role="status" aria-live="polite">
                    <strong>[ RUN ]</strong> {status}
                </div>
            )}
            {resultQuery != null && (
                <ShellQueryResultOverlay
                    query={resultQuery}
                    onClose={closeResultQuery}
                    dismissOnClickOutside={false}
                />
            )}
            {dialog}
        </main>
    );
};
