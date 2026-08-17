import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { FileDownloaderProvider } from '../platform/file/file_downloader_provider.js';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { PlatformTypeProvider } from '../platform/platform_type.js';
import { ProcessProvider } from '../platform/process.js';
import { EmbeddedDatabaseProvider } from '../platform/database/embedded_database_provider.js';
import { GitHubTheme } from '../theme/github_theme.js';
import { LoggerToast } from '../ui/logger/logger_toast.js';
import { ShellNavBar } from './shell_navbar.js';
import { ShellPage } from './shell_page.js';
import { ShellQueryExecutionTracker } from './query_execution.js';
import * as styles from './shell.module.css';

import '../../static/fonts/fonts.css';
import '../styles/colors.css';
import '../styles/globals.css';

export const Shell: React.FC = () => {
    const [engineVersion, setEngineVersion] = React.useState<string | null>(null);
    const [queryExecutions] = React.useState(() => new ShellQueryExecutionTracker());

    return (
        <PlatformTypeProvider>
            <LoggerProvider>
                <>
                    <LoggerToast />
                    <FileDownloaderProvider>
                        <ProcessProvider>
                            <EmbeddedDatabaseProvider>
                                <GitHubTheme>
                                    <div className={styles.root}>
                                        <ShellNavBar engineVersion={engineVersion} queryExecutions={queryExecutions} />
                                        <ShellPage onEngineVersion={setEngineVersion} queryExecutions={queryExecutions} />
                                    </div>
                                </GitHubTheme>
                            </EmbeddedDatabaseProvider>
                        </ProcessProvider>
                    </FileDownloaderProvider>
                </>
            </LoggerProvider>
        </PlatformTypeProvider>
    );
};

const element = document.getElementById('root');
createRoot(element!).render(<Shell />);
