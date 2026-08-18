import * as React from 'react';

import type { EmbeddedConnection } from '../platform/database/embedded_database.js';
import { useEmbeddedDatabaseSetup } from '../platform/database/embedded_database_provider.js';
import { stringifyError } from '../platform/logger/logger.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { createDashQLShell, type DashQLShell } from './api.js';
import type { BrowserShellController } from './browser_shell.js';
import { analyzeTable } from '../compute/computation_logic.js';
import { useComputationRegistry } from '../compute/computation_registry.js';
import { ShellQueryResultOverlay } from '../app/notebook/shell/shell_query_result_overlay.js';
import { createEmbeddedDatabaseShellEnvironment } from './embedded_database_shell_environment.js';
import { loginCommand } from './commands/login.js';
import { examplesCommand } from './commands/examples.js';
import { useShellConnection } from './shell_connection.js';
import { createShellOutputCommand, type ShellOutputMode } from './shell_result.js';
import { createShellFilesCommand, ShellFileRegistry } from './shell_files.js';
import { useFileDownloader } from '../platform/file/file_downloader_provider.js';
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
    const containerRef = React.useRef<HTMLDivElement>(null);
    const fileRegistryRef = React.useRef(new ShellFileRegistry());
    const outputModeRef = React.useRef<ShellOutputMode>('auto');
    const terminalColumnsRef = React.useRef(100);
    const [status, setStatus] = React.useState('Instantiating database');
    const [resultQueryId, setResultQueryId] = React.useState<number | null>(null);
    const queryExecutionSnapshot = React.useSyncExternalStore(
        queryExecutions.subscribe,
        queryExecutions.getSnapshot,
        queryExecutions.getSnapshot,
    );
    const resultQuery = resultQueryId == null
        ? null
        : queryExecutionSnapshot.find(query => query.queryId === resultQueryId) ?? null;

    React.useEffect(() => {
        if (containerRef.current == null) return;

        let cancelled = false;
        let connection: EmbeddedConnection | null = null;
        let shell: DashQLShell | null = null;
        let controller: BrowserShellController | null = null;

        const setup = async () => {
            const database = await setupEmbeddedDatabase(LOG_CTX);
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
                commands: [
                    examplesCommand,
                    loginCommand,
                    createShellOutputCommand(getOutputMode, mode => { outputModeRef.current = mode; }),
                    createShellFilesCommand(fileRegistryRef.current, fileDownloader),
                ],
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
                onQueryResult: setResultQueryId,
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
            setConnected(false);
            void connection?.close();
        };
    }, [dispatchComputation, fileDownloader, logger, props.onEngineVersion, queryExecutions, setConnected, setupEmbeddedDatabase]);

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
                <ShellQueryResultOverlay query={resultQuery} onClose={() => setResultQueryId(null)} />
            )}
        </main>
    );
};
