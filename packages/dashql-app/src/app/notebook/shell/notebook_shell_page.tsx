import * as React from 'react';
import * as styles from './notebook_shell_page.module.css';

import type { ConnectionState } from '../connections/connection_state.js';
import { useCancelQuery, useQueryExecutor, useQueryState } from '../connections/query_executor.js';
import { NotebookViewMode, useNotebookViewMode } from '../scripts/notebook_commands.js';
import { useLogger } from '../../../shared/platform/logger/logger_provider.js';
import { stringifyError } from '../../../shared/platform/logger/logger.js';
import {
    DashQLShell,
} from '../../../shell/api.js';
import type { BrowserShellController } from '../../../shell/browser_shell.js';
import { createNotebookShell } from './notebook_shell_catalog.js';
import {
    createNotebookShellEnvironment,
    createNotebookShellResultCommand,
    type NotebookShellResultMode,
} from './notebook_shell_environment.js';
import { ShellQueryResultOverlay } from './shell_query_result_overlay.js';

const LOG_CTX = 'notebook_shell_page';

function formatInstantiationProgress(bytesLoaded: number, bytesTotal: number): string {
    if (bytesTotal <= 0) return `Loading ${Math.round(bytesLoaded / 1000)} kB`;
    const blocks = Math.max(0, Math.min(10, Math.floor(bytesLoaded / bytesTotal * 10)));
    return `Loading [${'#'.repeat(blocks)}${'-'.repeat(10 - blocks)}]`;
}

interface Props {
    connection: ConnectionState | null;
    active: boolean;
}

export const NotebookShellPage: React.FC<Props> = ({ connection, active }) => {
    const logger = useLogger();
    const executeQuery = useQueryExecutor();
    const cancelQuery = useCancelQuery();
    const { setMode } = useNotebookViewMode();
    const containerRef = React.useRef<HTMLDivElement>(null);
    const controllerRef = React.useRef<BrowserShellController | null>(null);
    const shellRef = React.useRef<DashQLShell | null>(null);
    const generationRef = React.useRef(0);
    const resultModeRef = React.useRef<NotebookShellResultMode>('auto');
    const terminalColumnsRef = React.useRef(100);
    const [status, setStatus] = React.useState('Instantiating Shell');
    const [resultQueryId, setResultQueryId] = React.useState<number | null>(null);
    const resultQuery = useQueryState(connection?.notebookId ?? null, resultQueryId);
    const relationsSql = connection?.catalogRelationScript.toString() ?? '';
    const functionsSql = connection?.catalogFunctionScript.toString() ?? '';

    React.useEffect(() => {
        if (connection == null || containerRef.current == null) return;
        const generation = ++generationRef.current;
        let cancelled = false;
        const getResultMode = () => resultModeRef.current;
        const environment = createNotebookShellEnvironment(
            connection.notebookId,
            executeQuery,
            cancelQuery,
            getResultMode,
            () => terminalColumnsRef.current,
        );
        const resultCommand = createNotebookShellResultCommand(getResultMode, mode => {
            resultModeRef.current = mode;
        });
        setStatus(shellRef.current == null ? 'Instantiating Shell' : 'Refreshing shell catalog');
        void createNotebookShell({ relationsSql, functionsSql }, environment, {
            commands: [resultCommand],
            onProgress: progress => {
                if (!cancelled && generation === generationRef.current) {
                    setStatus(`Instantiating Shell: ${formatInstantiationProgress(progress.bytesLoaded, progress.bytesTotal)}`);
                }
            },
        }).then(async nextShell => {
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
                    greeter: ['DashQL Shell', 'Enter .help for usage hints.'],
                    prompt: `${connection.connectorInfo.names.displayShort.toLowerCase()}> `,
                    onExit: () => setMode(NotebookViewMode.Notebook),
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
            logger.error(message, {}, LOG_CTX);
            controllerRef.current?.writeStatus(message);
            setStatus(message);
        });
        return () => {
            cancelled = true;
        };
    }, [connection?.notebookId, relationsSql, functionsSql, executeQuery, cancelQuery, setMode]);

    React.useEffect(() => {
        if (active) controllerRef.current?.focus();
    }, [active]);

    React.useEffect(() => {
        setResultQueryId(null);
    }, [connection?.notebookId]);

    React.useEffect(() => () => {
        ++generationRef.current;
        controllerRef.current?.dispose();
        controllerRef.current = null;
        shellRef.current?.destroy();
        shellRef.current = null;
    }, []);

    return (
        <main className={styles.page} aria-label="DashQL shell">
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
        </main>
    );
};

export default NotebookShellPage;
