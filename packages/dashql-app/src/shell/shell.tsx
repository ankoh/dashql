import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { FileDownloaderProvider } from '../shared/platform/file/file_downloader_provider.js';
import { LoggerProvider } from '../shared/platform/logger/logger_provider.js';
import { PlatformTypeProvider } from '../shared/platform/platform_type.js';
import { ProcessProvider } from '../shared/platform/process.js';
import { DuckDBProvider } from '../shared/platform/duckdb/duckdb_provider.js';
import { VersionCheck } from '../shared/platform/version/version_check.js';
import { GitHubTheme } from '../shared/theme/github_theme.js';
import { LoggerToast } from '../shared/ui/logger/logger_toast.js';
import { ShellNavBar } from './shell_navbar.js';
import { ShellPage } from './shell_page.js';
import * as styles from './shell.module.css';

import '../../static/fonts/fonts.css';
import '../shared/styles/colors.css';
import '../shared/styles/globals.css';

export const Shell: React.FC = () => (
    <PlatformTypeProvider>
        <LoggerProvider>
            <>
                <LoggerToast />
                <FileDownloaderProvider>
                    <ProcessProvider>
                        <VersionCheck>
                            <DuckDBProvider>
                                <GitHubTheme>
                                    <div className={styles.root}>
                                        <ShellNavBar />
                                        <ShellPage />
                                    </div>
                                </GitHubTheme>
                            </DuckDBProvider>
                        </VersionCheck>
                    </ProcessProvider>
                </FileDownloaderProvider>
            </>
        </LoggerProvider>
    </PlatformTypeProvider>
);

const element = document.getElementById('root');
createRoot(element!).render(<Shell />);
