import * as React from 'react';
import * as styles from './workbook_shell_page.module.css';

import { WorkbookViewMode, useWorkbookViewMode } from '../workbook_view_mode.js';
import { useLogger } from '../../host/logger_provider.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import {
    DashQLShell,
} from '../../shell/terminal/api.js';
import { ShellView, type ShellViewController } from '../../shell/view/shell_view.js';
import {
    createWorkbookShellEnvironment,
    resolveClientFunctionCall,
} from './workbook_shell_environment.js';
import { ShellQueryResultOverlay } from './shell_query_result_overlay.js';
import { createShellLastCommand } from '../../shell/terminal/shell_result.js';
import { useAppConfig } from '../../config/app_config.js';
import { getKeywordCase } from '../scripts/script_format.js';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { ShellFileRegistry } from '../../shell/terminal/shell_files.js';
import { useShellFiles } from '../../shell/terminal/filesystem_dialog.js';
import { createExamplesCommand } from '../../shell/terminal/shell_examples.js';
import { splitShellScript } from '../../shell/terminal/shell_script.js';
import { useSnippetsDialog } from '../snippets/snippets_dialog.js';
import { connectorInfoOf } from '@akohn/dashql/platform/connections/connection_state';
import type * as core from '@akohn/dashql';
import { useCatalog, useComputeDatabase, useConnection, useOptionalRuntime } from '@akohn/dashql-react/hooks';
import { useShellQueryResult } from '../../shell/page/use_shell_query_result.js';

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
    /// The ordinal that tells the connection apart from others of its connector in the list of the connections
    ordinal?: number | null;
    /// The label of the connection in the list of the connections, with its ordinal
    label?: core.ConnectionLabel | null;
    active: boolean;
    dependencies?: WorkbookShellPageDependencies;
}

export const WorkbookShellPage: React.FC<Props> = ({ workbookId, workbookName, connectionId, ordinal = null, label = null, active, dependencies = DEFAULT_DEPENDENCIES }) => {
    const ResultOverlay = dependencies.ShellQueryResultOverlay;
    const activeRef = React.useRef(active);
    activeRef.current = active;
    const connection = useConnection(connectionId);
    // The shell runs on the catalog of its connection, the runtime shares it
    const runtime = useOptionalRuntime();
    const catalog = useCatalog(connection?.connectionId);
    const keywordCase = getKeywordCase(useAppConfig()?.settings);
    const logger = useLogger();
    // The shell calls the executor of the runtime when it runs a query, a test may replace it meanwhile
    const runtimeRef = React.useRef(runtime);
    runtimeRef.current = runtime;
    const { setMode } = useWorkbookViewMode();
    const controllerRef = React.useRef<ShellViewController | null>(null);
    const [shell, setShell] = React.useState<DashQLShell | null>(null);
    const shellRef = React.useRef<DashQLShell | null>(null);
    const generationRef = React.useRef(0);
    const [status, setStatus] = React.useState('Instantiating Shell');
    const releaseResult = React.useCallback((queryId: number) => {
        runtime?.dispatch({ computation: queryId }, { kind: 'deleteComputation' });
    }, [runtime]);
    const { resultQuery, showResultQuery, closeResultQuery, reopenResultQuery, dropResultQuery } = useShellQueryResult(releaseResult);
    const showResultError = (error: unknown, info: React.ErrorInfo) => {
        dropResultQuery();
        // The shell says what happened, an error would also raise a toast
        logger.warn('Failed to show a query result', { error: stringifyError(error), stack: info.componentStack ?? '' }, LOG_CTX);
        controllerRef.current?.writeStatus(`Failed to show the result: ${stringifyError(error)}`);
    };
    const connectorName = (connection == null ? undefined : connectorInfoOf(connection))?.names.displayShort ?? '';
    // The shell names its connection like the workbench does, e.g. "Hyper #2 Http Shell" with the prompt "hyper#2> "
    const shellName = connection == null ? 'Shell' : `${(label ?? connection.label).text} Shell`;
    const prompt = `${connectorName.toLowerCase()}${ordinal == null ? '' : `#${ordinal}`}> `;
    // The greeter names the shell and its workbook
    const greeter = React.useMemo(() => workbookName
        ? [shellName, `Workbook: ${workbookName}`, 'Enter .help for usage hints.']
        : [shellName, 'Enter .help for usage hints.'], [shellName, workbookName]);
    const { controller: snippetsDialog, dialog: snippetsBrowserDialog } = useSnippetsDialog(
        connection?.connectorType ?? ConnectorType.HYPER,
    );

    // The shell mounts files into the embedded Hyper that a Hyper WASM connection queries.
    // The mounts belong to the shell, they are removed when the shell closes or switches the connection.
    const database = useComputeDatabase();
    const mountsFiles = connection?.embedded ?? false;
    const fileRegistryRef = React.useRef<ShellFileRegistry | null>(null);
    const { command: filesCommand, dialogs: fileDialogs } = useShellFiles(fileRegistryRef);
    React.useEffect(() => {
        if (!mountsFiles || database == null) return;
        const registry = new ShellFileRegistry(logger, database);
        fileRegistryRef.current = registry;
        return () => {
            if (fileRegistryRef.current === registry) fileRegistryRef.current = null;
            void registry.dispose();
        };
    }, [connection?.connectionId, database, logger, mountsFiles]);

    // The shell follows its connection by id, an event of the connection keeps it
    const shellConnectionId = connection?.connectionId ?? null;
    React.useEffect(() => {
        if (shellConnectionId == null || catalog == null) return;
        const generation = ++generationRef.current;
        let cancelled = false;
        const environment = createWorkbookShellEnvironment(
            workbookId,
            shellConnectionId,
            (connectionId, args) => {
                const current = runtimeRef.current;
                if (current == null) throw new Error('the query executor needs a RuntimeProvider');
                return current.execute(connectionId, args);
            },
            async queryId => { await runtimeRef.current?.cancel(queryId); },
            releaseResult,
            query => resolveClientFunctionCall(catalog, query),
            async (queryId, limit) => {
                const current = runtimeRef.current;
                if (current == null) throw new Error('the preview of a result needs a RuntimeProvider');
                return await current.previewResult(queryId, 0, limit, false);
            },
        );
        const lastCommand = createShellLastCommand(reopenResultQuery);
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
            core: catalog.ptr.api,
            catalog,
            environment,
            commands: mountsFiles ? [examplesCommand, lastCommand, filesCommand] : [examplesCommand, lastCommand],
        }).then(nextShell => {
            if (cancelled || generation !== generationRef.current) {
                nextShell.destroy();
                return;
            }
            // The next shell continues the history of the previous one
            const previous = shellRef.current;
            if (previous != null) nextShell.importHistory(previous.exportHistory());
            shellRef.current = nextShell;
            setShell(nextShell);
            setStatus('');
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
    }, [shellConnectionId, workbookId, catalog, snippetsDialog, mountsFiles, filesCommand, releaseResult, reopenResultQuery, logger]);

    React.useEffect(() => {
        if (active) controllerRef.current?.focus();
    }, [active]);

    React.useEffect(() => {
        dropResultQuery();
    }, [connection?.connectionId, dropResultQuery]);

    // A shell goes once the view shows the next one, or with the page
    React.useEffect(() => () => shell?.destroy(), [shell]);
    React.useEffect(() => () => {
        ++generationRef.current;
        shellRef.current = null;
    }, []);
    const exitShell = React.useCallback(() => setMode(WorkbookViewMode.Workbook), [setMode]);
    const mayFocus = React.useCallback(() => activeRef.current, []);

    return (
        <main className={styles.page} aria-label={shellName}>
            <div className={styles.terminal}>
                <ShellView
                    shell={shell}
                    greeter={greeter}
                    status={status}
                    prompt={prompt}
                    inputAriaLabel={`${shellName} input`}
                    keywordCase={keywordCase}
                    onQueryResult={showResultQuery}
                    onExit={exitShell}
                    mayFocus={mayFocus}
                    controller={controllerRef}
                />
            </div>
            {resultQuery != null && (
                <ResultOverlay query={resultQuery} onClose={closeResultQuery} onError={showResultError} />
            )}
            {snippetsBrowserDialog}
            {fileDialogs}
        </main>
    );
};

export default WorkbookShellPage;
