import * as React from 'react';

import { stringifyError } from '../platform/logger/logger.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { GitHubTheme } from '../styles/github_theme.js';
import { Button } from '../ui/foundations/button.js';
import { ErrorBoundary } from '../ui/foundations/error_boundary.js';
import * as styles from './shell_error_boundary.module.css';

const LOG_CTX = 'standalone_shell';

interface Props {
    reload?: () => void;
    children: React.ReactNode;
}

/// Catch what fails to render in the shell page. The terminal and the database connection are gone by then, only a
/// reload brings them back. The fallback can't rely on the providers below the boundary.
export function ShellErrorBoundary({ reload = () => window.location.reload(), children }: Props): React.ReactElement {
    const logger = useLogger();
    const onError = (error: unknown, info: React.ErrorInfo) => {
        logger.error('The shell failed to render', { error: stringifyError(error), stack: info.componentStack ?? '' }, LOG_CTX);
    };
    return (
        <ErrorBoundary
            onError={onError}
            fallback={error => (
                <GitHubTheme>
                    <main className={styles.page} aria-label="HyperDB Shell">
                        <section className={styles.card} role="alert">
                            <h1>The shell stopped working</h1>
                            <p>{stringifyError(error)}</p>
                            <Button onClick={reload}>Reload</Button>
                        </section>
                    </main>
                </GitHubTheme>
            )}
        >
            {children}
        </ErrorBoundary>
    );
}
