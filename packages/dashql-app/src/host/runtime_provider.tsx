import * as React from 'react';
import type * as core from '@akohn/dashql';

import { createRuntime, type QueryCommands, type Runtime } from '@akohn/dashql/runtime/runtime';
import { createRuntimeArchives } from '@akohn/dashql/runtime/workbook_archives';
import type { HttpClient } from '@akohn/dashql/platform/http_client';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';

import { AppOAuthFlow } from '../oauth/app_oauth_flow.js';
import { RuntimeContextProvider, useOwnedRuntime } from '@akohn/dashql-react/hooks';
import { useSalesforceMock } from '../connections/salesforce/salesforce_connector.js';
import { mockSalesforceHttp, mockSalesforceOAuthFlow } from '@akohn/dashql/platform/connections/salesforce/salesforce_api_client_mock';
import { createChannelConnector, type ChannelClients } from '../connections/hyper/hyper_connection_setup.js';
import { HyperLogMetricsProvider, useCreateHyperLogMetrics } from '../connections/hyper/hyper_log_metrics_provider.js';
import { NativeHyperDatabaseClient } from '../connections/hyper/native_hyperdb_grpc_client.js';
import { isDesktopHost } from '@akohn/dashql-react/dom/app_host';
import { useEmbeddedDatabaseSetup } from './embedded_database_provider.js';
import { usePlatformEventListener } from './events/event_listener_provider.js';
import { useHttpClient } from './http/http_client_provider.js';
import { useLogger } from './logger_provider.js';
import { usePlatformType } from './platform_type.js';
import { useQueryResultCache } from '../storage/query_result_cache_provider.js';
import { useStorageReader } from '../storage/storage_provider.js';
import { useAppHandOver } from './app_hand_over.js';
import { FRAME_UPDATE_SCHEDULER } from '../utils/store_hooks.js';
import { useDashQLCore } from './core_provider.js';

const NO_HTTP: HttpClient = {
    fetch: () => Promise.reject(new Error('the app has no http client')),
};

interface Props {
    /// The core of the runtime, by default the one of the DashQLCoreProvider above
    core?: core.DashQL;
    /// Run the catalog loader, true by default. The tests of components stop it.
    catalogLoader?: boolean;
    /// Stand in for the query commands of the runtime, e.g. in a test of components
    queryCommands?: Partial<QueryCommands>;
    /// What shows until the core is there
    loading?: React.ReactNode;
    children?: React.ReactNode;
}

/// The runtime of DashQL (packages/dashql/src/runtime/runtime.ts) over the platform of the app: the storage, the http
/// client, the core and the embedded database of the providers above it. The provider creates it once
/// the core is there and shows `loading` until then. The hooks of `@akohn/dashql-react/hooks` read from it.
export function RuntimeProvider(props: Props) {
    const provided = useDashQLCore();
    const core = props.core ?? provided;
    if (core == null) return <>{props.loading ?? null}</>;
    return <AppRuntime core={core} catalogLoader={props.catalogLoader} queryCommands={props.queryCommands}>{props.children}</AppRuntime>;
}

/// The runtime over the providers of the app, it lives as long as the component
function AppRuntime(props: { core: core.DashQL; catalogLoader?: boolean; queryCommands?: Partial<QueryCommands>; children?: React.ReactNode }) {
    const logger = useLogger();
    const storage = useStorageReader();
    const http = useHttpClient();
    const resultCache = useQueryResultCache();
    const appEvents = usePlatformEventListener();
    const platformType = usePlatformType();
    const logMetrics = useCreateHyperLogMetrics();
    // The platform owns what it passes to the runtime for the lifetime of the runtime. The parts that the providers
    // above set up later or change with the settings are read when the runtime asks: the mock of Salesforce that the
    // config may choose and the embedded database.
    const latest = {
        salesforceMock: useSalesforceMock(),
        setupEmbeddedDatabase: useEmbeddedDatabaseSetup(),
        queryCommands: props.queryCommands,
    };
    const ref = React.useRef(latest);
    ref.current = latest;

    const runtime = useOwnedRuntime(() => {
        // The desktop app speaks Hyper over gRPC through its native proxy, the runtime speaks Hyper over HTTP itself
        const grpcClient = isDesktopHost() ? new NativeHyperDatabaseClient(logger) : null;
        const clients = (): ChannelClients => ({
            grpcClient,
            setupEmbeddedDatabase: ref.current.setupEmbeddedDatabase,
            logMetrics,
        });
        return createRuntime({
            logger,
            core: props.core,
            storage: storage.backend,
            http: mockSalesforceHttp(() => ref.current.salesforceMock, http ?? NO_HTTP),
            scheduler: FRAME_UPDATE_SCHEDULER,
            oauthFlow: mockSalesforceOAuthFlow(() => ref.current.salesforceMock, new AppOAuthFlow(appEvents, platformType)),
            channels: createChannelConnector(clients),
            // The embedded database starts once the settings loaded, the runtime waits for it
            computeDatabase: ref.current.setupEmbeddedDatabase == null ? null : () => ref.current.setupEmbeddedDatabase('compute'),
            resultCache,
            archives: handles => createRuntimeArchives(handles, context => ref.current.setupEmbeddedDatabase(context)),
            catalogLoader: props.catalogLoader,
            // The commands that a test replaces are read when they are called
            queryCommands: {
                get execute() { return ref.current.queryCommands?.execute; },
                get cancel() { return ref.current.queryCommands?.cancel; },
                get watchProfile() { return ref.current.queryCommands?.watchProfile; },
            },
        });
    });
    return <AppRuntimeServices runtime={runtime} logMetrics={logMetrics}>{props.children}</AppRuntimeServices>;
}

/// What the app does with its runtime: the flushes of the storage writer and the handover to another tab
function AppRuntimeServices(props: { runtime: Runtime; logMetrics: ReturnType<typeof useCreateHyperLogMetrics>; children?: React.ReactNode }) {
    const { runtime, logMetrics } = props;
    const logger = useLogger();

    // The app shows whether runs can read results once the compute database is set up, it is set up right away
    React.useEffect(() => runtime.computeDatabase.prepare(), [runtime]);

    // Write the pending changes when the page goes away, the writer debounces them. Browsers don't wait for the writes
    // when the page unloads, a hidden page usually still finishes them. Electron asks for the writes before it closes a
    // window and waits for them.
    React.useEffect(() => {
        const writer = runtime.storage;
        // A page that goes away keeps the scripts that a change outside the app holds as recovery copies next to them,
        // a page that goes to the back-forward cache comes back with them pending
        const flush = async (closing: boolean) => {
            try {
                await writer.flush({ closing });
            } catch (error) {
                logger.error("Failed to flush the storage writer", { error: stringifyError(error) }, "runtime");
            }
        };
        const flushIfHidden = () => {
            if (document.visibilityState === 'hidden') void flush(false);
        };
        const flushOnPageHide = (event: PageTransitionEvent) => void flush(!event.persisted);
        window.addEventListener('pagehide', flushOnPageHide);
        document.addEventListener('visibilitychange', flushIfHidden);
        const removeElectronFlush = globalThis.dashqlElectron?.onFlush(() => flush(true));
        return () => {
            window.removeEventListener('pagehide', flushOnPageHide);
            document.removeEventListener('visibilitychange', flushIfHidden);
            removeElectronFlush?.();
        };
    }, [runtime, logger]);

    // Another tab takes over the app, the pending writes finish first and nothing is written after
    useAppHandOver(async () => {
        await runtime.storage.handOver();
    });

    return (
        <RuntimeContextProvider value={runtime}>
            <HyperLogMetricsProvider metrics={logMetrics}>
                <>{props.children}</>
            </HyperLogMetricsProvider>
        </RuntimeContextProvider>
    );
}
