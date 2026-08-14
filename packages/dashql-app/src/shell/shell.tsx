import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { FileDownloaderProvider } from '../platform/file/file_downloader_provider.js';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { PlatformTypeProvider } from '../platform/platform_type.js';
import { ProcessProvider } from '../platform/process.js';
import { DuckDBProvider } from '../platform/duckdb/duckdb_provider.js';
import { VersionCheck } from '../platform/version/version_check.js';
import { GitHubTheme } from '../github_theme.js';
import { LoggerToast } from '../view/logger_toast.js';
import { ShellNavBar } from './shell_navbar.js';
import { ShellPage } from './shell_page.js';
import * as styles from './shell.module.css';

import './../../static/fonts/fonts.css';
import '../colors.css';
import '../globals.css';

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
