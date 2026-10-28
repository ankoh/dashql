import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom';

import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { EmbeddedDatabaseProvider } from '../platform/database/embedded_database_provider.js';
import { HttpClientProvider } from '../platform/http/http_client_provider.js';
import { GitHubTheme } from '../theme/github_theme.js';
import { LoggerToast } from '../ui/logger/logger_toast.js';
import { FlavorProvider } from '../app/flavor/flavor_provider.js';
import { FLAVOR_QUERY_PARAMETER, getRequestedFlavor, resolveFlavor } from '../app/flavor/flavor_resolution.js';
import { DASHQL_FLAVOR, type AppFlavor } from '../app/flavor/flavors.js';
import { DEMOS, type DemoEntry } from './demo_registry.js';
import * as styles from './demos.module.css';

import '../../static/fonts/fonts.css';
import '../styles/colors.css';
import '../styles/globals.css';
import '../styles/flavors/sidp.css';

/// The pages of the demos, loaded when they are opened
const PAGES = new Map(DEMOS.map(demo => [demo.id, React.lazy(demo.load)]));

/// The list of the demos
const DemoIndex: React.FC = () => (
    <div className={styles.index}>
        <h1 className={styles.index_title}>DashQL Demos</h1>
        <ul className={styles.index_list}>
            {DEMOS.map((demo: DemoEntry) => (
                <li key={demo.id}>
                    <Link className={styles.index_entry} to={`/${demo.id}`}>
                        <span className={styles.index_entry_title}>{demo.title}</span>
                        <span className={styles.index_entry_description}>{demo.description}</span>
                    </Link>
                </li>
            ))}
        </ul>
    </div>
);

/// The page of the demo of the route
const DemoPage: React.FC = () => {
    const { demoId } = useParams();
    const Page = demoId == null ? undefined : PAGES.get(demoId);
    if (Page == null) return <Navigate to="/" replace />;
    return (
        <React.Suspense fallback={<div className={styles.loading}>Loading…</div>}>
            <Page />
        </React.Suspense>
    );
};

/// Demos of DashQL on Hyper, every demo is a page of its own.
/// The routes are hashes, `demos.html#/<id>`, so that every host serves the page without rewrites.
/// A flavor is requested in front of the hash, `demos.html?flavor=sidp#/<id>`, or in the query of the route.
export const Demos: React.FC = () => (
    <HashRouter>
        <LoggerProvider>
            <>
                <LoggerToast />
                <HttpClientProvider>
                    <EmbeddedDatabaseProvider>
                        <GitHubTheme>
                            <div className={styles.root}>
                                <Routes>
                                    <Route index element={<DemoIndex />} />
                                    <Route path="/:demoId" element={<DemoPage />} />
                                </Routes>
                            </div>
                        </GitHubTheme>
                    </EmbeddedDatabaseProvider>
                </HttpClientProvider>
            </>
        </LoggerProvider>
    </HashRouter>
);

/// The flavor requested by the query of the route, `#/<id>?flavor=sidp`, or else by the query in front of the hash
function getRequestedDemoFlavor(): AppFlavor | null {
    const hash = globalThis.location?.hash ?? '';
    const query = hash.indexOf('?');
    const requested = query < 0 ? null : new URLSearchParams(hash.slice(query + 1)).get(FLAVOR_QUERY_PARAMETER);
    if (requested == null) return getRequestedFlavor();
    const resolution = resolveFlavor(requested);
    if (resolution.unknownId !== undefined) console.warn(`unknown app flavor: ${resolution.unknownId}`);
    return resolution.flavor;
}

// The demos are branded as DashQL, only a flavor other than the default one rebrands them, e.g. their chart colors
const requested = getRequestedDemoFlavor();
const flavor = requested?.id === DASHQL_FLAVOR.id ? null : requested;

const element = document.getElementById('root');
createRoot(element!).render(flavor == null ? <Demos /> : (
    <FlavorProvider requested={flavor}>
        <Demos />
    </FlavorProvider>
));
