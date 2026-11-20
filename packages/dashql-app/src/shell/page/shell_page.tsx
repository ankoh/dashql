import * as React from 'react';

import * as connectionTypes from '@akohn/dashql-jsonschema/connection.js';

import { useEmbeddedDatabaseSetup } from '../../host/embedded_database_provider.js';
import { LoggableException, stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useLogger } from '../../host/logger_provider.js';
import { useDashQLCoreSetup, useDashQLCoreSetupProgress } from '../../host/core_provider.js';
import { createDashQLShell, type DashQLShell, type DashQLShellCommand } from '../terminal/api.js';
import type { BrowserShellController } from '../terminal/browser_shell.js';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { ShellQueryResultOverlay } from '../../workbook/shell/shell_query_result_overlay.js';
import { connectEmbeddedSession, type EmbeddedSession } from '@akohn/dashql/runtime/embedded_session';
import { createEmbeddedDatabaseShellEnvironment } from './embedded_database_shell_environment.js';
import { createLoginCommand } from './commands/login.js';
import { SalesforceLoginHistoryStore } from './salesforce_login_history.js';
import { createExamplesCommand } from '../terminal/shell_examples.js';
import { useShellQueryHistory } from './shell_query_history.js';
import { createShellLastCommand } from '../terminal/shell_result.js';
import { externalDirectoryDatabase, externalFileDatabase, ShellFileRegistry } from '../terminal/shell_files.js';
import { useShellFiles } from '../terminal/filesystem_dialog.js';
import { createFormatCommand } from './commands/format.js';
import { createPlanCommand } from './commands/plan.js';
import { createShareCommand } from './commands/share.js';
import { useSalesforceLoginDialog } from './salesforce_login_dialog.js';
import { AppOAuthFlow } from '../../oauth/app_oauth_flow.js';
import { useHttpClient } from '../../host/http/http_client_provider.js';
import { usePlatformEventListener } from '../../host/events/event_listener_provider.js';
import { PlatformType, usePlatformType } from '../../host/platform_type.js';
import { useAppConfig } from '../../config/app_config.js';
import { getKeywordCase } from '../../workbook/scripts/script_format.js';
import { useShellQueryResult } from './use_shell_query_result.js';
import { useFormatDialog } from './format_dialog.js';
import { usePlanDialog } from './plan_dialog.js';
import { useShareDialog } from './share_dialog.js';
import { useSnippetsDialog } from '../../workbook/snippets/snippets_dialog.js';
import { decodeShareScript, readShareScriptFromLocation } from './shell_share.js';
import { splitShellScript } from '../terminal/shell_script.js';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { getHyperDBWebSupportError } from '../../host/hyperdb/hyperdb_web_support.js';
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

const INSTANTIATING_SHELL = 'Instantiating shell';

export const ShellPage: React.FC<ShellPageProps> = (props: ShellPageProps) => {
    const logger = useLogger();
    const setupCore = useDashQLCoreSetup();
    const coreProgress = useDashQLCoreSetupProgress();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const shellHistory = useShellQueryHistory();
    const runtime = useRuntime();
    const httpClient = useHttpClient();
    const appEvents = usePlatformEventListener();
    const platformType = usePlatformType();
    const appConfig = useAppConfig();
    const keywordCase = getKeywordCase(appConfig?.settings);
    const hyperDBSupportError = platformType === PlatformType.WEB ? getHyperDBWebSupportError() : null;
    const keywordCaseRef = React.useRef(keywordCase);
    keywordCaseRef.current = keywordCase;
    // The login reads the config when it runs, a config that arrives later must not tear down the shell
    const appConfigRef = React.useRef(appConfig);
    appConfigRef.current = appConfig;
    const loginHistoryRef = React.useRef(new SalesforceLoginHistoryStore());
    const { onEngineVersion } = props;
    const { controller: loginDialog, dialog } = useSalesforceLoginDialog({
        nativeOAuth: platformType !== PlatformType.WEB,
        loadHistory: () => loginHistoryRef.current.load(),
        deleteHistoryEntry: organizationId => loginHistoryRef.current.delete(organizationId),
    });
    const { controller: formatDialog, dialog: formatterDialog } = useFormatDialog();
    const { controller: planDialog, dialog: queryPlanDialog } = usePlanDialog(appEvents);
    const { controller: shareDialog, dialog: shareScriptDialog } = useShareDialog();
    const { controller: snippetsDialog, dialog: snippetsBrowserDialog } = useSnippetsDialog(ConnectorType.HYPER);
    const fileRegistryRef = React.useRef<ShellFileRegistry | null>(null);
    const { command: filesCommand, dialogs: fileDialogs } = useShellFiles(fileRegistryRef);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [status, setStatus] = React.useState('Instantiating hyperdb-wasm');
    const shellRef = React.useRef<DashQLShell | null>(null);
    const controllerRef = React.useRef<BrowserShellController | null>(null);
    React.useEffect(() => {
        shellRef.current?.setKeywordCase(keywordCase);
    }, [keywordCase]);
    const releaseResult = React.useCallback((queryId: number) => {
        runtime.dispatch({ computation: queryId }, { kind: 'deleteComputation' });
    }, [runtime]);
    const { resultQuery, showResultQuery, closeResultQuery, reopenResultQuery, dropResultQuery } = useShellQueryResult(releaseResult);
    const showResultError = (error: unknown, info: React.ErrorInfo) => {
        dropResultQuery();
        // The terminal says what happened, an error would also raise a toast
        logger.warn('Failed to show a query result', { error: stringifyError(error), stack: info.componentStack ?? '' }, LOG_CTX);
        controllerRef.current?.writeStatus(`Failed to show the result: ${stringifyError(error)}`);
    };

    React.useEffect(() => {
        if (hyperDBSupportError != null) return;
        if (containerRef.current == null) return;

        let cancelled = false;
        // The logins of the shell are setups of the runtime by an id each
        let loginCount = 0;
        // The connection of the shell to the embedded Hyper, a connection of its runtime: the statements of the shell run
        // with the query executor of the runtime on it and its catalog follows them
        let session: EmbeddedSession | null = null;
        let shell: DashQLShell | null = null;
        let controller: BrowserShellController | null = null;
        let fileRegistry: ShellFileRegistry | null = null;

        const setup = async () => {
            setStatus('Instantiating hyperdb-wasm');
            const database = await setupEmbeddedDatabase(LOG_CTX, progress => {
                if (!cancelled) {
                    setStatus(`Instantiating hyperdb-wasm: ${formatInstantiationProgress(progress.bytesLoaded, progress.bytesTotal)}`);
                }
            });
            void database.getVersion()
                .then(version => {
                    if (!cancelled) onEngineVersion(version);
                })
                .catch(error => {
                    logger.warn('Failed to load engine version', { error: stringifyError(error) }, LOG_CTX);
                });

            setStatus(INSTANTIATING_SHELL);
            const core = await setupCore(LOG_CTX);
            // A later setup of the page takes the connection
            if (cancelled) return;
            const nextSession = await connectEmbeddedSession(runtime, shellHistory.connectionId);
            if (cancelled) {
                nextSession.close();
                return;
            }
            session = nextSession;
            const loginCommand = createLoginCommand({
                requestForm: loginDialog.request,
                authenticate: async (form, signal, onProgress) => {
                    if (!httpClient) throw new Error('HTTP client is not ready');
                    const oauthRedirect = appConfigRef.current?.connectors?.salesforce?.auth?.oauthRedirect;
                    if (!oauthRedirect) throw new Error('Salesforce OAuth redirect is not configured');
                    const params: connectionTypes.SalesforceConnectionParams = {
                        instanceUrl: form.instanceUrl,
                        appConsumerKey: form.appConsumerKey,
                        appConsumerSecret: '',
                        login: form.loginHint,
                    };
                    // The runtime logs in with the flow of this login, the window of the click of the user
                    const loginId = `shell-login-${++loginCount}`;
                    const cancel = () => runtime.cancelSetup(loginId);
                    signal?.addEventListener('abort', cancel, { once: true });
                    const messages: Record<string, string> = {
                        GENERATING_PKCE_CHALLENGE: 'Preparing secure Salesforce login',
                        OAUTH_NATIVE_LINK_OPENED: 'Waiting for Salesforce authorization in your browser',
                        OAUTH_WEB_WINDOW_OPENED: 'Waiting for Salesforce authorization',
                        REQUESTING_CORE_AUTH_TOKEN: 'Exchanging Salesforce authorization code',
                        REQUESTING_DATA_CLOUD_ACCESS_TOKEN: 'Requesting Data Cloud credentials',
                    };
                    try {
                        const outcome = await runtime.authenticateSalesforce(loginId, params, {
                            oauthRedirect,
                            forceRelogin: appConfigRef.current?.settings?.forceReLogin ?? false,
                        }, {
                            oauthFlow: new AppOAuthFlow(appEvents, platformType, form.oauthPopup ?? null),
                            // The steps are names, the tokens come with the outcome
                            onStep: step => {
                                const message = messages[step];
                                if (message) {
                                    onProgress?.(message);
                                    loginDialog.update({ status: message });
                                }
                            },
                        });
                        if (outcome.status === 'cancelled') throw signal?.reason ?? new DOMException(outcome.message ?? 'The login was cancelled', 'AbortError');
                        if (outcome.authentication == null) throw new LoggableException(outcome.message ?? 'The login failed', outcome.data, LOG_CTX);
                        const { tokens, userInfo } = outcome.authentication;
                        const coreUserInfo = (userInfo ?? undefined) as connectionTypes.SalesforceCoreUserInfo | undefined;
                        loginDialog.update({
                            status: 'Received Data Cloud access token',
                            coreAccessToken: tokens.core,
                            dataCloudAccessToken: tokens.dataCloud,
                            login: coreUserInfo?.preferredUsername ?? coreUserInfo?.email ?? '',
                        });
                        return { coreAccessToken: tokens.core, dataCloudAccessToken: tokens.dataCloud, coreUserInfo };
                    } finally {
                        signal?.removeEventListener('abort', cancel);
                    }
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
                    loginDialog.succeed(`Authenticated with Salesforce as ${form.alias}`);
                },
                onError: error => {
                    loginDialog.fail(stringifyError(error));
                    return 'retry';
                },
            });
            fileRegistry = new ShellFileRegistry(
                logger,
                externalFileDatabase(database),
                externalDirectoryDatabase(database),
            );
            fileRegistryRef.current = fileRegistry;
            const commands: DashQLShellCommand[] = [
                createExamplesCommand({
                    requestSnippet: snippetsDialog.request,
                    splitPrompts: text => {
                        if (shell == null) throw new Error('Shell is not ready');
                        return splitShellScript(shell.core, shell.catalog, text);
                    },
                    // The prompts are filled in once the command finished
                    queuePrompts: prompts => controller?.queuePrompts(prompts),
                }),
                createFormatCommand({
                    requestDialog: signal => {
                        if (shell == null) throw new Error('Shell is not ready');
                        return formatDialog.request(shell.core, shell.catalog, signal);
                    },
                }),
                createPlanCommand({
                    requestDialog: signal => {
                        if (shell == null) throw new Error('Shell is not ready');
                        return planDialog.request(shell.core, signal);
                    },
                }),
                createShareCommand({
                    requestDialog: signal => {
                        if (shell == null) throw new Error('Shell is not ready');
                        return shareDialog.request(shell.core, shell.catalog, signal);
                    },
                }),
                loginCommand,
                createShellLastCommand(reopenResultQuery),
                filesCommand,
            ];
            const nextShell = await createDashQLShell({
                core,
                catalog: nextSession.catalog,
                // The executor analyzes the results as computations on the database of the shell, the connection lists
                // their queries
                environment: createEmbeddedDatabaseShellEnvironment((connectionId, args) => runtime.execute(connectionId, args), nextSession.connectionId, {
                    // The prompt returns once the catalog followed the statement, waiting must not fail it
                    afterStatement: async () => {
                        try {
                            await runtime.settleCatalog(nextSession.connectionId);
                        } catch (error) {
                            logger.warn('Failed to update the catalog of the shell', { error: stringifyError(error) }, LOG_CTX);
                        }
                    },
                    previewResult: (queryId, limit) => runtime.previewResult(queryId, limit),
                }),
                autoQualifyNonDefaultDatabaseTables: true,
                commands,
            });
            if (cancelled || containerRef.current == null) {
                nextShell.destroy();
                return;
            }
            shell = nextShell;
            shellRef.current = nextShell;
            nextShell.setKeywordCase(keywordCaseRef.current);
            const { embedDashQLShell } = await import('../terminal/browser_shell.js');
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
            });
            if (cancelled) {
                nextController.dispose();
                return;
            }
            controller = nextController;
            controllerRef.current = nextController;
            setStatus('');

            // Offer the statements of a shared script one after another
            const sharedScript = readShareScriptFromLocation();
            if (sharedScript == null) return;
            try {
                const text = await decodeShareScript(sharedScript);
                if (cancelled) return;
                const prompts = splitShellScript(nextShell.core, nextShell.catalog, text);
                if (prompts.length === 0) return;
                nextController.writeStatus(`Shared script with ${prompts.length} ${prompts.length === 1 ? 'statement' : 'statements'}. Press Enter to run each, Ctrl+C to skip the rest.`);
                nextController.queuePrompts(prompts);
            } catch (error) {
                if (cancelled) return;
                logger.warn('Failed to load shared script', { error: stringifyError(error) }, LOG_CTX);
                nextController.writeStatus(`Failed to load shared script: ${stringifyError(error)}`);
            }
        };

        void setup().catch(error => {
            if (cancelled) return;
            const message = `Failed to load shell: ${stringifyError(error)}`;
            logger.warn(message, {}, LOG_CTX);
            setStatus(message);
        });

        return () => {
            cancelled = true;
            controller?.dispose();
            controllerRef.current = null;
            shell?.destroy();
            shellRef.current = null;
            fileRegistryRef.current = null;
            // The connection stops after the shell, its channel closes the session
            void (fileRegistry?.dispose() ?? Promise.resolve()).finally(() => session?.close());
        };
    }, [appEvents, runtime, filesCommand, setupCore, formatDialog, httpClient, hyperDBSupportError, logger, loginDialog, planDialog, platformType, onEngineVersion, shellHistory, reopenResultQuery, setupEmbeddedDatabase, shareDialog, showResultQuery, snippetsDialog]);

    if (hyperDBSupportError != null) {
        return (
            <main className={styles.page} aria-label="HyperDB Shell">
                <section className={styles.unsupported} role="alert">
                    <h1>Unsupported platform</h1>
                    <p>{hyperDBSupportError}</p>
                </section>
            </main>
        );
    }

    return (
        <main className={styles.page} aria-label="HyperDB Shell">
            <div className={styles.terminal}>
                <div ref={containerRef} className={styles.terminalHost} />
            </div>
            {status && (
                <div className={styles.status} role="status" aria-live="polite">
                    <strong>[ RUN ]</strong> {status === INSTANTIATING_SHELL && coreProgress != null
                        ? `${status}: ${formatInstantiationProgress(Number(coreProgress.bytesLoaded), Number(coreProgress.bytesTotal))}`
                        : status}
                </div>
            )}
            {resultQuery != null && (
                <ShellQueryResultOverlay
                    query={resultQuery}
                    onClose={closeResultQuery}
                    onError={showResultError}
                    dismissOnClickOutside={false}
                />
            )}
            {dialog}
            {formatterDialog}
            {queryPlanDialog}
            {shareScriptDialog}
            {snippetsBrowserDialog}
            {fileDialogs}
        </main>
    );
};
