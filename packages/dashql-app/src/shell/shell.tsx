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
import { ShellConnectionProvider } from './shell_connection.js';
import { ConnectionRegistry } from '../app/notebook/connections/connection_registry.js';
import * as styles from './shell.module.css';

import '../../static/fonts/fonts.css';
import '../styles/colors.css';
import '../styles/globals.css';

export const Shell: React.FC = () => {
    const [engineVersion, setEngineVersion] = React.useState<string | null>(null);

    return (
        <PlatformTypeProvider>
            <LoggerProvider>
                <>
                    <LoggerToast />
                    <FileDownloaderProvider>
                        <ProcessProvider>
                            <EmbeddedDatabaseProvider>
                                <GitHubTheme>
                                    <ConnectionRegistry>
                                        <ShellConnectionProvider>
                                            <div className={styles.root}>
                                                <ShellNavBar engineVersion={engineVersion} />
                                                <ShellPage onEngineVersion={setEngineVersion} />
                                            </div>
                                        </ShellConnectionProvider>
                                    </ConnectionRegistry>
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
