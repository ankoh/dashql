import * as React from 'react';
import * as styles from './workbook_shell_page.module.css';

import { useConnectionById } from '../../connections/connection_registry.js';
import { useCancelQuery, useQueryExecutor, useQueryState } from '../../connections/query_executor.js';
import { WorkbookViewMode, useWorkbookViewMode } from '../workbook_view_mode.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';
import {
    DashQLShell,
} from '../../shell/api.js';
import type { BrowserShellController } from '../../shell/browser_shell.js';
import {
    createWorkbookShellEnvironment,
    resolveClientFunctionCall,
} from './workbook_shell_environment.js';
import { ShellQueryResultOverlay } from './shell_query_result_overlay.js';
import { createShellLastCommand } from '../../shell/shell_result.js';
import { useAppConfig } from '../../config/app_config.js';
import { getKeywordCase } from '@ankoh/dashql-runtime/workbook/scripts/script_format';
import { ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { connectionLabelParts, connectionLabelText, isHyperWasmConnection } from '@ankoh/dashql-runtime/connections/connection_label';
import { useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { useComputationDispatch } from '../../compute/computation_registry.js';
import { DELETE_COMPUTATION } from '@ankoh/dashql-runtime/compute/computation_state';
import { externalDirectoryDatabase, externalFileDatabase, ShellFileRegistry } from '../../shell/shell_files.js';
import { useShellFiles } from '../../shell/filesystem_dialog.js';
import { createExamplesCommand } from '../../shell/shell_examples.js';
import { splitShellScript } from '../../shell/shell_script.js';
import { useSnippetsDialog } from '../snippets/snippets_dialog.js';

const LOG_CTX = 'workbook_shell_page';

export interface WorkbookShellPageDependencies {
    ShellQueryResultOverlay: typeof ShellQueryResultOverlay;
}

const DEFAULT_DEPENDENCIES: WorkbookShellPageDependencies = {
    ShellQueryResultOverlay,
};

interface Props {
    workbookId: string;
    workbookName?: string | null;
    /// The connection the shell runs on
    connectionId: string;
    /// The ordinal that tells the connection apart from others of its connector, see `connectionOrdinals`
    ordinal?: number | null;
    active: boolean;
    dependencies?: WorkbookShellPageDependencies;
}

export const WorkbookShellPage: React.FC<Props> = ({ workbookId, workbookName, connectionId, ordinal = null, active, dependencies = DEFAULT_DEPENDENCIES }) => {
    const ResultOverlay = dependencies.ShellQueryResultOverlay;
    const activeRef = React.useRef(active);
    activeRef.current = active;
    const [connection] = useConnectionById(connectionId);
    const keywordCase = getKeywordCase(useAppConfig()?.settings);
    const keywordCaseRef = React.useRef(keywordCase);
    keywordCaseRef.current = keywordCase;
    const logger = useLogger();
    // The shell calls the latest executor: a new one, e.g. once the compute database is set up, keeps the shell
    const executor = { execute: useQueryExecutor(), cancel: useCancelQuery() };
    const executorRef = React.useRef(executor);
    executorRef.current = executor;
    const { setMode } = useWorkbookViewMode();
    const containerRef = React.useRef<HTMLDivElement>(null);
    const controllerRef = React.useRef<BrowserShellController | null>(null);
    const shellRef = React.useRef<DashQLShell | null>(null);
    React.useEffect(() => {
        shellRef.current?.setKeywordCase(keywordCase);
    }, [keywordCase]);
    const generationRef = React.useRef(0);
    const [status, setStatus] = React.useState('Instantiating Shell');
    const [resultQueryId, setResultQueryId] = React.useState<number | null>(null);
    const [resultOpen, setResultOpen] = React.useState(false);
    const resultQuery = useQueryState(workbookId, resultQueryId);
    const resultQueryRef = React.useRef(resultQuery);
    resultQueryRef.current = resultQuery;
    const showResult = React.useCallback((queryId: number) => {
        setResultQueryId(queryId);
        setResultOpen(true);
    }, []);
    // Closing the overlay keeps the result so that it can open again, the computation of a result is released once
    // another result replaces it
    const computationDispatch = useComputationDispatch();
    const releaseResult = React.useCallback((queryId: number) => {
        computationDispatch({ type: DELETE_COMPUTATION, value: [queryId] });
    }, [computationDispatch]);
    React.useEffect(() => {
        if (resultQueryId == null) return;
        return () => releaseResult(resultQueryId);
    }, [resultQueryId, releaseResult]);
    const showResultError = (error: unknown, info: React.ErrorInfo) => {
        // A result that failed to render doesn't open again
        setResultQueryId(null);
        // The terminal says what happened, an error would also raise a toast
        logger.warn('Failed to show a query result', { error: stringifyError(error), stack: info.componentStack ?? '' }, LOG_CTX);
        controllerRef.current?.writeStatus(`Failed to show the result: ${stringifyError(error)}`);
    };
    const connectorName = connection?.connectorInfo.names.displayShort ?? '';
    // The shell names its connection like the workbench does, e.g. "Hyper #2 Http Shell" with the prompt "hyper#2> "
    const shellName = connection == null ? 'Shell' : `${connectionLabelText(connectionLabelParts(connection, ordinal))} Shell`;
    const prompt = `${connectorName.toLowerCase()}${ordinal == null ? '' : `#${ordinal}`}> `;
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
        const environment = createWorkbookShellEnvironment(
            workbookId,
            connection.connectionId,
            (connectionId, args) => executorRef.current.execute(connectionId, args),
            (connectionId, queryId) => executorRef.current.cancel(connectionId, queryId),
            releaseResult,
            query => resolveClientFunctionCall(connection.catalog, query),
        );
        const lastCommand = createShellLastCommand(() => {
            if (resultQueryRef.current == null) return false;
            setResultOpen(true);
            return true;
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
        setStatus('Instantiating Shell');
        // The shell runs on the catalog of its connection, so it follows the catalog as it changes
        void DashQLShell.create({
            core: connection.catalog.ptr.api,
            catalog: connection.catalog,
            environment,
            commands: mountsFiles ? [examplesCommand, lastCommand, filesCommand] : [examplesCommand, lastCommand],
        }).then(async nextShell => {
            nextShell.setKeywordCase(keywordCaseRef.current);
            if (cancelled || generation !== generationRef.current) {
                nextShell.destroy();
                return;
            }
            if (controllerRef.current == null) {
                const { embedDashQLShell } = await import('../../shell/browser_shell.js');
                if (cancelled || generation !== generationRef.current || containerRef.current == null) {
                    nextShell.destroy();
                    return;
                }
                let controller: BrowserShellController;
                try {
                    controller = await embedDashQLShell({
                        container: containerRef.current,
                        shell: nextShell,
                        greeter: workbookName ? [shellName, `Workbook: ${workbookName}`, 'Enter .help for usage hints.'] : [shellName, 'Enter .help for usage hints.'],
                        prompt,
                        onExit: () => setMode(WorkbookViewMode.Workbook),
                        onQueryResult: showResult,
                        mayFocus: () => activeRef.current,
                    });
                } catch (error) {
                    nextShell.destroy();
                    throw error;
                }
                // The inputs changed or the page closed while the terminal opened, the terminal of a newer run takes over
                if (cancelled || generation !== generationRef.current) {
                    controller.dispose();
                    nextShell.destroy();
                    return;
                }
                controllerRef.current = controller;
            } else {
                controllerRef.current.replaceShell(nextShell, prompt);
            }
            const previous = shellRef.current;
            shellRef.current = nextShell;
            previous?.destroy();
            setStatus('');
            if (activeRef.current) controllerRef.current.focus();
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
    }, [connection?.connectionId, connection?.catalog, prompt, workbookName, shellName, setMode, snippetsDialog, mountsFiles, filesCommand, releaseResult, showResult]);

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
            {resultOpen && resultQuery != null && (
                <ResultOverlay query={resultQuery} onClose={() => setResultOpen(false)} onError={showResultError} />
            )}
            {snippetsBrowserDialog}
            {fileDialogs}
        </main>
    );
};

export default WorkbookShellPage;
