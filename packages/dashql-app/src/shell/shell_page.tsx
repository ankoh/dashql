import * as React from 'react';

import type { DuckDBConnection } from '../shared/platform/duckdb/duckdb_api.js';
import { useDuckDBSetup } from '../shared/platform/duckdb/duckdb_provider.js';
import { stringifyError } from '../shared/platform/logger/logger.js';
import { useLogger } from '../shared/platform/logger/logger_provider.js';
import { createDashQLShell, type DashQLShell } from './api.js';
import type { BrowserShellController } from './browser_shell.js';
import { createDuckDBShellEnvironment } from './duckdb_shell_environment.js';
import { loginCommand } from './commands/login.js';
import type { ShellQueryExecutionTracker } from './query_execution.js';
import * as styles from './shell_page.module.css';

const LOG_CTX = 'standalone_shell';

interface ShellPageProps {
    onEngineVersion: (version: string) => void;
    queryExecutions: ShellQueryExecutionTracker;
}

function formatInstantiationProgress(bytesLoaded: number, bytesTotal: number): string {
    if (bytesTotal <= 0) return `Loading ${Math.round(bytesLoaded / 1000)} kB`;
    const blocks = Math.max(0, Math.min(10, Math.floor(bytesLoaded / bytesTotal * 10)));
    return `Loading [${'#'.repeat(blocks)}${'-'.repeat(10 - blocks)}]`;
}

export const ShellPage: React.FC<ShellPageProps> = (props: ShellPageProps) => {
    const logger = useLogger();
    const setupDuckDB = useDuckDBSetup();
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [status, setStatus] = React.useState('Instantiating database');

    React.useEffect(() => {
        if (containerRef.current == null) return;

        let cancelled = false;
        let connection: DuckDBConnection | null = null;
        let shell: DashQLShell | null = null;
        let controller: BrowserShellController | null = null;

        const setup = async () => {
            const database = await setupDuckDB(LOG_CTX);
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

            setStatus('Instantiating shell');
            const nextShell = await createDashQLShell({
                environment: createDuckDBShellEnvironment(connection, props.queryExecutions),
                commands: [loginCommand],
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
            void connection?.close();
        };
    }, [logger, props.onEngineVersion, props.queryExecutions, setupDuckDB]);

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
        </main>
    );
};
