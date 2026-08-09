import * as React from 'react';
import * as styles from './notebook_shell_page.module.css';

import type { ConnectionState } from '../../../connection/connection_state.js';
import { useCancelQuery, useQueryExecutor } from '../../../connection/query_executor.js';
import { NotebookViewMode, useNotebookViewMode } from '../../../scripts/notebook_commands.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import { createNotebookShell, createNotebookShellEnvironment, DashQLShell } from '../../../shell/index.js';
import type { BrowserShellController } from '../../../shell/browser_shell.js';

const LOG_CTX = 'notebook_shell_page';

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
    const [status, setStatus] = React.useState('Loading shell');
    const relationsSql = connection?.catalogRelationScript.toString() ?? '';
    const functionsSql = connection?.catalogFunctionScript.toString() ?? '';

    React.useEffect(() => {
        if (connection == null || containerRef.current == null) return;
        const generation = ++generationRef.current;
        let cancelled = false;
        const environment = createNotebookShellEnvironment(connection.notebookId, executeQuery, cancelQuery);
        setStatus(shellRef.current == null ? 'Loading shell' : 'Refreshing shell catalog');
        void createNotebookShell({ relationsSql, functionsSql }, environment).then(async nextShell => {
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
                    prompt: `${connection.connectorInfo.names.displayShort.toLowerCase()}> `,
                    onExit: () => setMode(NotebookViewMode.Notebook),
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

    React.useEffect(() => () => {
        ++generationRef.current;
        controllerRef.current?.dispose();
        controllerRef.current = null;
        shellRef.current?.destroy();
        shellRef.current = null;
    }, []);

    return (
        <main className={styles.page} aria-label="DashQL shell">
            <div ref={containerRef} className={styles.terminal} />
            <div className={styles.status} role="status" aria-live="polite">{status}</div>
        </main>
    );
};

export default NotebookShellPage;
