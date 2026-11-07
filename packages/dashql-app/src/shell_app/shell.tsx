import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { EmbeddedDatabaseProvider } from '../platform/database/embedded_database_provider.js';
import { GitHubTheme } from '../styles/github_theme.js';
import { LoggerToast } from '../ui/logger/logger_toast.js';
import { ShellNavBar } from './shell_navbar.js';
import { ShellPage } from './shell_page.js';
import { ShellQueryHistoryProvider } from './shell_query_history.js';
import { ComputationRegistry } from '../compute/computation_registry.js';
import { ComputationScheduler } from '../compute/computation_scheduler.js';
import { DashQLCoreProvider } from '../runtime/core_provider.js';
import { ShellComputeQueryExecutionProvider } from './shell_compute_query_execution.js';
import { AppConfigProvider } from '../config/app_config.js';
import { PlatformEventListenerProvider } from '../platform/events/event_listener_provider.js';
import { HttpClientProvider } from '../platform/http/http_client_provider.js';
import { FlavorProvider } from '../config/flavor_provider.js';
import { getRequestedFlavor } from '../config/flavor_resolution.js';
import { DASHQL_FLAVOR } from '../config/flavors.js';
import * as styles from './shell.module.css';

import '@ankoh/dashql-ui/fonts/fonts.css';
import '@ankoh/dashql-ui/styles/colors.css';
import '@ankoh/dashql-ui/styles/tokens.css';
import '../styles/globals.css';
import '@ankoh/dashql-ui/styles/flavors/dbcom.css';

export const Shell: React.FC = () => {
    const [engineVersion, setEngineVersion] = React.useState<string | null>(null);
    const [shellGeneration, setShellGeneration] = React.useState(0);
    const resetShell = () => {
        setEngineVersion(null);
        setShellGeneration(generation => generation + 1);
    };

    return (
        <BrowserRouter>
            <LoggerProvider>
                <>
                    <LoggerToast />
                    <AppConfigProvider>
                        <PlatformEventListenerProvider>
                            <HttpClientProvider>
                                <EmbeddedDatabaseProvider>
                                    <GitHubTheme>
                                        <DashQLCoreProvider>
                                            <ComputationRegistry>
                                                <ShellQueryHistoryProvider key={shellGeneration}>
                                                    <ShellComputeQueryExecutionProvider>
                                                        <ComputationScheduler />
                                                        <div className={styles.root}>
                                                            <ShellNavBar
                                                                engineVersion={engineVersion}
                                                                onReset={resetShell}
                                                            />
                                                            <ShellPage onEngineVersion={setEngineVersion} />
                                                        </div>
                                                    </ShellComputeQueryExecutionProvider>
                                                </ShellQueryHistoryProvider>
                                            </ComputationRegistry>
                                        </DashQLCoreProvider>
                                    </GitHubTheme>
                                </EmbeddedDatabaseProvider>
                            </HttpClientProvider>
                        </PlatformEventListenerProvider>
                    </AppConfigProvider>
                </>
            </LoggerProvider>
        </BrowserRouter>
    );
};

// The shell is branded for Hyper, only a flavor other than the default one rebrands it
const requested = getRequestedFlavor();
const flavor = requested?.id === DASHQL_FLAVOR.id ? null : requested;

const element = document.getElementById('root');
createRoot(element!).render(flavor == null ? <Shell /> : (
    <FlavorProvider requested={flavor}>
        <Shell />
    </FlavorProvider>
));
