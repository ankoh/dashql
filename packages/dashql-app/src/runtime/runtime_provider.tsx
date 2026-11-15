import * as React from 'react';

import { createRuntime, type Runtime } from '@ankoh/dashql-runtime/runtime';
import type { HttpClient } from '@ankoh/dashql-runtime/platform/http/http_client';
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';

import { AppOAuthFlow } from '../oauth/app_oauth_flow.js';
import { useComputeDatabase } from '../compute/compute_connection_provider.js';
import { ComputationsProvider } from '../compute/computation_registry.js';
import { useSalesforceAPI } from '../connections/salesforce/salesforce_connector.js';
import { usePlatformEventListener } from '../platform/events/event_listener_provider.js';
import { useHttpClient } from '../platform/http/http_client_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { usePlatformType } from '../platform/platform_type.js';
import { useQueryResultCache } from '../storage/query_result_cache_provider.js';
import { useStorage } from '../storage/storage_provider.js';
import { FRAME_UPDATE_SCHEDULER } from '../utils/store_hooks.js';
import { useDashQLCoreSetup } from './core_provider.js';

const RUNTIME_CTX = React.createContext<Runtime | null>(null);

/// The runtime of the app
export function useRuntime(): Runtime {
    const runtime = React.useContext(RUNTIME_CTX);
    if (runtime == null) throw new Error('useRuntime must be used within RuntimeProvider');
    return runtime;
}

/// The runtime of the app, null outside of the provider. Hooks that resolve a service only when their function is
/// called use it, a test may render a component without the runtime as long as it doesn't call them.
export function useOptionalRuntime(): Runtime | null {
    return React.useContext(RUNTIME_CTX);
}

const NO_HTTP: HttpClient = {
    fetch: () => Promise.reject(new Error('the app has no http client')),
};
const NO_CORE = () => Promise.reject(new Error('the app has no core'));

interface Props {
    /// The runtime to provide, e.g. one of a test. By default the provider creates one over the providers above it.
    runtime?: Runtime;
    children?: React.ReactNode;
}

/// The runtime of DashQL (packages/dashql-runtime/src/runtime.ts). By default over the platform of the app: the
/// storage and its writer, the http client, the core and the embedded database of the providers above it. The hooks of the
/// registries and the services read from it.
export function RuntimeProvider(props: Props) {
    if (props.runtime != null) return <ProvideRuntime runtime={props.runtime}>{props.children}</ProvideRuntime>;
    return <AppRuntime>{props.children}</AppRuntime>;
}

/// The runtime over the providers of the app, it lives as long as the component
function AppRuntime(props: { children?: React.ReactNode }) {
    const logger = useLogger();
    const [storage, storageWriter] = useStorage();
    const http = useHttpClient();
    const setupCore = useDashQLCoreSetup();
    const resultCache = useQueryResultCache();
    const computeDatabase = useComputeDatabase();
    const salesforce = useSalesforceAPI();
    const appEvents = usePlatformEventListener();
    const platformType = usePlatformType();

    const [runtime] = React.useState(() => createRuntime({
        logger,
        storage: storage.backend,
        storageWriter,
        http: http ?? NO_HTTP,
        scheduler: FRAME_UPDATE_SCHEDULER,
        oauthFlow: new AppOAuthFlow(appEvents, platformType),
        setupCore: setupCore ?? NO_CORE,
        computeDatabase,
        resultCache,
        salesforce: salesforce ?? undefined,
    }));

    // The embedded database starts after the settings loaded and the config may choose the mock of Salesforce. They
    // are set during the render: a run that a handler of a child starts in the same render reads them.
    const attached = React.useRef({ computeDatabase, salesforce });
    if (computeDatabase != null && attached.current.computeDatabase !== computeDatabase) {
        attached.current.computeDatabase = computeDatabase;
        runtime.setComputeDatabase(computeDatabase);
    }
    if (salesforce != null && attached.current.salesforce !== salesforce) {
        attached.current.salesforce = salesforce;
        runtime.setSalesforce(salesforce);
    }

    React.useEffect(() => () => {
        void runtime.destroy().catch(error => {
            logger.error("Failed to stop the runtime", { error: stringifyError(error) }, "runtime");
        });
    }, [runtime, logger]);

    return <ProvideRuntime runtime={runtime}>{props.children}</ProvideRuntime>;
}

function ProvideRuntime(props: { runtime: Runtime; children?: React.ReactNode }) {
    return (
        <RUNTIME_CTX.Provider value={props.runtime}>
            <ComputationsProvider value={props.runtime.computations}>
                {props.children}
            </ComputationsProvider>
        </RUNTIME_CTX.Provider>
    );
}
