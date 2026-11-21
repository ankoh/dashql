import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { LoggerProvider } from '../../host/logger_provider.js';
import { EmbeddedDatabaseProvider } from '../../host/embedded_database_provider.js';
import { DashQLCoreProvider } from '../../host/core_provider.js';
import { StandaloneRuntime } from '../../host/standalone_runtime.js';
import { LoggerToast } from '../../diagnostics/logger_toast.js';
import { GitHubTheme } from '../../styles/github_theme.js';
import { UnpackerPage } from './unpacker_page.js';
import * as styles from './unpacker_page.module.css';

import '@akohn/dashql-react/fonts/fonts.css';
import '@akohn/dashql-react/styles/colors.css';
import '@akohn/dashql-react/styles/tokens.css';
import '../../styles/globals.css';

/// The unpacker tool, `/tools/unpacker`. A tool sets up only the parts of DashQL it uses (docs/design/tools.md): the
/// logger, the embedded Hyper that reads the Parquet files, and the core with a runtime without storage, connections
/// or HTTP client, whose computations back the data tables.
export const Unpacker: React.FC = () => (
    <LoggerProvider>
        <LoggerToast />
        <EmbeddedDatabaseProvider>
            <GitHubTheme>
                <DashQLCoreProvider>
                    <StandaloneRuntime fallback={<div className={styles.loading}>Loading DashQL…</div>}>
                        <UnpackerPage />
                    </StandaloneRuntime>
                </DashQLCoreProvider>
            </GitHubTheme>
        </EmbeddedDatabaseProvider>
    </LoggerProvider>
);

const element = document.getElementById('root');
createRoot(element!).render(<Unpacker />);
