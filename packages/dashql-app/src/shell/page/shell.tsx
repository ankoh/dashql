import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { LoggerProvider } from '../../host/logger_provider.js';
import { EmbeddedDatabaseProvider, useEmbeddedDatabaseSetup } from '../../host/embedded_database_provider.js';
import { GitHubTheme } from '../../styles/github_theme.js';
import { LoggerToast } from '../../diagnostics/logger_toast.js';
import { ShellErrorBoundary } from './shell_error_boundary.js';
import { ShellNavBar } from './shell_navbar.js';
import { ShellPage } from './shell_page.js';
import { ShellQueryHistoryProvider } from './shell_query_history.js';
import { shellChannelConnector } from './shell_connection.js';
import { StandaloneRuntime } from '../../host/standalone_runtime.js';
import { DashQLCoreProvider } from '../../host/core_provider.js';
import { AppConfigProvider } from '../../config/app_config.js';
import { PlatformEventListenerProvider } from '../../host/events/event_listener_provider.js';
import { HttpClientProvider } from '../../host/http/http_client_provider.js';
import { FlavorProvider } from '../../config/flavor_provider.js';
import { getRequestedFlavor } from '../../config/flavor_resolution.js';
import { DASHQL_FLAVOR } from '../../config/flavors.js';
import * as styles from './shell.module.css';

import '@akohn/dashql-react/fonts/fonts.css';
import '@akohn/dashql-react/styles/colors.css';
import '@akohn/dashql-react/styles/tokens.css';
import '../../styles/globals.css';
import '@akohn/dashql-react/styles/flavors/dbcom.css';
import '../../connections/bundled_clfn_specs.js';

/// The runtime of the shell, its connection to the embedded Hyper of the page follows the statements of the shell
const ShellRuntime = (props: { children?: React.ReactNode }) => {
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const [channels] = React.useState(() => shellChannelConnector(setupEmbeddedDatabase));
    return <StandaloneRuntime channels={channels}>{props.children}</StandaloneRuntime>;
};

/// Keep an element in the visible part of the window. The keyboard of iOS covers the window instead of shrinking it,
/// the prompt of the shell would sit behind it. A zoomed page keeps its height.
function useVisualViewportHeight(element: HTMLElement | null) {
    React.useEffect(() => {
        const viewport = window.visualViewport;
        if (viewport == null || element == null) return;
        const fit = () => {
            element.style.height = viewport.scale > 1.01 ? '' : `${viewport.height}px`;
            // iOS scrolls the window to the focused prompt, the element starts at the top of the visible part
            if (viewport.scale <= 1.01) window.scrollTo(0, 0);
        };
        fit();
        viewport.addEventListener('resize', fit);
        return () => {
            viewport.removeEventListener('resize', fit);
            element.style.height = '';
        };
    }, [element]);
}

export const Shell: React.FC = () => {
    const [engineVersion, setEngineVersion] = React.useState<string | null>(null);
    const [shellGeneration, setShellGeneration] = React.useState(0);
    // The providers mount the root once they are ready
    const [root, setRoot] = React.useState<HTMLDivElement | null>(null);
    useVisualViewportHeight(root);

    // A file dropped on the page doesn't open in place of the shell
    React.useEffect(() => {
        const ignore = (event: DragEvent) => event.preventDefault();
        window.addEventListener('dragover', ignore);
        window.addEventListener('drop', ignore);
        return () => {
            window.removeEventListener('dragover', ignore);
            window.removeEventListener('drop', ignore);
        };
    }, []);
    const resetShell = () => {
        setEngineVersion(null);
        setShellGeneration(generation => generation + 1);
    };

    return (
        <BrowserRouter>
            <LoggerProvider>
                <ShellErrorBoundary>
                    <LoggerToast />
                    <AppConfigProvider>
                        <PlatformEventListenerProvider>
                            <HttpClientProvider>
                                <EmbeddedDatabaseProvider>
                                    <GitHubTheme>
                                        <DashQLCoreProvider>
                                            <ShellRuntime>
                                                <ShellQueryHistoryProvider key={shellGeneration}>
                                                    <div ref={setRoot} className={styles.root}>
                                                        <ShellNavBar
                                                            engineVersion={engineVersion}
                                                            onReset={resetShell}
                                                        />
                                                        <ShellPage onEngineVersion={setEngineVersion} />
                                                    </div>
                                                </ShellQueryHistoryProvider>
                                            </ShellRuntime>
                                        </DashQLCoreProvider>
                                    </GitHubTheme>
                                </EmbeddedDatabaseProvider>
                            </HttpClientProvider>
                        </PlatformEventListenerProvider>
                    </AppConfigProvider>
                </ShellErrorBoundary>
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
