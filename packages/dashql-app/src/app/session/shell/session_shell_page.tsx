import * as React from 'react';
import * as styles from './session_shell_page.module.css';

import type { ConnectionState } from '../../connections/connection_state.js';
import { useCancelQuery, useQueryExecutor, useQueryState } from '../../connections/query_executor.js';
import { SessionViewMode, useSessionViewMode } from '../ui/session_view_mode.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import {
    DashQLShell,
} from '../../../shell/api.js';
import type { BrowserShellController } from '../../../shell/browser_shell.js';
import { createSessionShell } from './session_shell_catalog.js';
import {
    createSessionShellEnvironment,
} from './session_shell_environment.js';
import { ShellQueryResultOverlay } from './shell_query_result_overlay.js';
import { createShellOutputCommand, type ShellOutputMode } from '../../../shell/shell_result.js';
import { useAppConfig } from '../../config/app_config.js';
import { getKeywordCase } from '../ui/script_format.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { isHyperWasmConnection } from '../../connections/ui/connection_label.js';
import { useComputeDatabase } from '../../../compute/compute_connection_provider.js';
import { externalDirectoryDatabase, externalFileDatabase, ShellFileRegistry } from '../../../shell/shell_files.js';
import { useShellFiles } from '../../../shell/filesystem_dialog.js';
import { createExamplesCommand } from '../../../shell/shell_examples.js';
import { splitShellScript } from '../../../shell/shell_script.js';
import { useSnippetsDialog } from './snippets_dialog.js';

const LOG_CTX = 'session_shell_page';

function formatInstantiationProgress(bytesLoaded: number, bytesTotal: number): string {
    if (bytesTotal <= 0) return `Loading ${Math.round(bytesLoaded / 1000)} kB`;
    const blocks = Math.max(0, Math.min(10, Math.floor(bytesLoaded / bytesTotal * 10)));
    return `Loading [${'#'.repeat(blocks)}${'-'.repeat(10 - blocks)}]`;
}

interface Props {
    sessionId: string;
    sessionName?: string | null;
    connection: ConnectionState | null;
    active: boolean;
}

export const SessionShellPage: React.FC<Props> = ({ sessionId, sessionName, connection, active }) => {
    const keywordCase = getKeywordCase(useAppConfig()?.settings);
    const keywordCaseRef = React.useRef(keywordCase);
    keywordCaseRef.current = keywordCase;
    const logger = useLogger();
    const executeQuery = useQueryExecutor();
    const cancelQuery = useCancelQuery();
    const { setMode } = useSessionViewMode();
    const containerRef = React.useRef<HTMLDivElement>(null);
    const controllerRef = React.useRef<BrowserShellController | null>(null);
    const shellRef = React.useRef<DashQLShell | null>(null);
    React.useEffect(() => {
        shellRef.current?.setKeywordCase(keywordCase);
    }, [keywordCase]);
    const generationRef = React.useRef(0);
    const outputModeRef = React.useRef<ShellOutputMode>('auto');
    const terminalColumnsRef = React.useRef(100);
    const [status, setStatus] = React.useState('Instantiating Shell');
    const [resultQueryId, setResultQueryId] = React.useState<number | null>(null);
    const resultQuery = useQueryState(sessionId, resultQueryId);
    const connectorName = connection?.connectorInfo.names.displayShort ?? '';
    const shellName = `${sessionName ?? connectorName} Shell`;
    const relationsSql = connection?.catalogRelationScript.toString() ?? '';
    const functionsSql = connection?.catalogFunctionScript.toString() ?? '';
    const { controller: snippetsDialog, dialog: snippetsBrowserDialog } = useSnippetsDialog(
        connection?.connectorInfo.connectorType ?? ConnectorType.HYPER,
    );

    // The shell mounts files into the embedded Hyper that a Hyper WASM connection queries.
    // The mounts belong to the shell, they are removed when the shell closes or switches the connection.
    const database = useComputeDatabase();
    const mountsFiles = connection != null && isHyperWasmConnection(connection);
    const fileRegistryRef = React.useRef<ShellFileRegistry | null>(null);
    const { command: filesCommand, dialogs: fileDialogs } = useShellFiles(fileRegistryRef);
    React.useEffect(() => {
        if (!mountsFiles || database == null) return;
        const registry = new ShellFileRegistry(logger, externalFileDatabase(database), externalDirectoryDatabase(database));
        fileRegistryRef.current = registry;
        return () => {
            if (fileRegistryRef.current === registry) fileRegistryRef.current = null;
            void registry.dispose();
        };
    }, [connection?.connectionId, database, logger, mountsFiles]);

    React.useEffect(() => {
        if (connection == null || containerRef.current == null) return;
        const generation = ++generationRef.current;
        let cancelled = false;
        const getOutputMode = () => outputModeRef.current;
        const environment = createSessionShellEnvironment(
            sessionId,
            connection.connectionId,
            executeQuery,
            cancelQuery,
            getOutputMode,
            () => terminalColumnsRef.current,
        );
        const outputCommand = createShellOutputCommand(getOutputMode, mode => {
            outputModeRef.current = mode;
        });
        const examplesCommand = createExamplesCommand({
            requestSnippet: snippetsDialog.request,
            splitPrompts: text => {
                const shell = shellRef.current;
                if (shell == null) throw new Error('Shell is not ready');
                return splitShellScript(shell.core, shell.catalog, text);
            },
            // The prompts are filled in once the command finished
            queuePrompts: prompts => controllerRef.current?.queuePrompts(prompts),
        });
        setStatus(shellRef.current == null ? 'Instantiating Shell' : 'Refreshing shell catalog');
        void createSessionShell({ relationsSql, functionsSql }, environment, {
            commands: mountsFiles ? [examplesCommand, outputCommand, filesCommand] : [examplesCommand, outputCommand],
            onProgress: progress => {
                if (!cancelled && generation === generationRef.current) {
                    setStatus(`Instantiating Shell: ${formatInstantiationProgress(progress.bytesLoaded, progress.bytesTotal)}`);
                }
            },
        }).then(async nextShell => {
            nextShell.setKeywordCase(keywordCaseRef.current);
            if (cancelled || generation !== generationRef.current) {
                nextShell.destroy();
                return;
            }
            if (controllerRef.current == null) {
                const { embedDashQLShell } = await import('../../../shell/browser_shell.js');
                if (cancelled || generation !== generationRef.current || containerRef.current == null) {
                    nextShell.destroy();
                    return;
                }
                controllerRef.current = await embedDashQLShell({
                    container: containerRef.current,
                    shell: nextShell,
                    greeter: [shellName, 'Enter .help for usage hints.'],
                    prompt: `${connectorName.toLowerCase()}> `,
                    onExit: () => setMode(SessionViewMode.Session),
                    onQueryResult: setResultQueryId,
                    onTerminalResize: columns => { terminalColumnsRef.current = columns; },
                });
            } else {
                controllerRef.current.replaceShell(nextShell);
                controllerRef.current.writeStatus('Catalog refreshed');
            }
            const previous = shellRef.current;
            shellRef.current = nextShell;
            previous?.destroy();
            setStatus('');
            if (active) controllerRef.current.focus();
        }).catch(error => {
            if (cancelled || generation !== generationRef.current) return;
            const message = `Failed to load shell: ${stringifyError(error)}`;
            logger.warn(message, {}, LOG_CTX);
            controllerRef.current?.writeStatus(message);
            setStatus(message);
        });
        return () => {
            cancelled = true;
        };
    }, [connection?.connectionId, connectorName, shellName, relationsSql, functionsSql, executeQuery, cancelQuery, setMode, snippetsDialog, mountsFiles, filesCommand]);

    React.useEffect(() => {
        if (active) controllerRef.current?.focus();
    }, [active]);

    React.useEffect(() => {
        setResultQueryId(null);
    }, [connection?.connectionId]);

    React.useEffect(() => () => {
        ++generationRef.current;
        controllerRef.current?.dispose();
        controllerRef.current = null;
        shellRef.current?.destroy();
        shellRef.current = null;
    }, []);

    return (
        <main className={styles.page} aria-label={shellName}>
            <div className={styles.terminal}>
                <div ref={containerRef} className={styles.terminalHost} />
            </div>
            {status && (
                <div className={styles.status} role="status" aria-live="polite">
                    <strong>[ RUN ]</strong> {status}
                </div>
            )}
            {resultQuery != null && (
                <ShellQueryResultOverlay query={resultQuery} onClose={() => setResultQueryId(null)} />
            )}
            {snippetsBrowserDialog}
            {fileDialogs}
        </main>
    );
};

export default SessionShellPage;
