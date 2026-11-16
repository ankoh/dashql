import * as React from 'react';

import { createRuntime, type Runtime } from '@ankoh/dashql/runtime/runtime';
import { createRuntimeArchives } from '@ankoh/dashql/runtime/storage/workbook_archives';
import type { HttpClient } from '@ankoh/dashql/platform/platform/http/http_client';
import { stringifyError } from '@ankoh/dashql/platform/platform/logger/logger';

import { AppOAuthFlow } from '../oauth/app_oauth_flow.js';
import { useComputeDatabase } from '../compute/compute_connection_provider.js';
import { RuntimeContextProvider } from './runtime_hooks.js';
import { useSalesforceAPI } from '../connections/salesforce/salesforce_connector.js';
import { usePlatformEventListener } from '../platform/events/event_listener_provider.js';
import { useHttpClient } from '../platform/http/http_client_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { usePlatformType } from '../platform/platform_type.js';
import { useQueryResultCache } from '../storage/query_result_cache_provider.js';
import { useStorageReader } from '../storage/storage_provider.js';
import { useAppHandOver } from '../platform/crosstab/app_hand_over.js';
import { FRAME_UPDATE_SCHEDULER } from '../utils/store_hooks.js';
import { useDashQLCoreSetup } from './core_provider.js';
import { useWorkbookArchiveDatabase } from '../workbook/persistence/workbook_archive_database.js';

const NO_HTTP: HttpClient = {
    fetch: () => Promise.reject(new Error('the app has no http client')),
};
const NO_CORE = () => Promise.reject(new Error('the app has no core'));

interface Props {
    /// The runtime to provide, e.g. one of a test. By default the provider creates one over the providers above it.
    runtime?: Runtime;
    children?: React.ReactNode;
}

/// The runtime of DashQL (packages/dashql/src/runtime/runtime.ts). By default over the platform of the app: the
/// storage, the http client, the core and the embedded database of the providers above it. The hooks of
/// `runtime_hooks.tsx` read from it.
export function RuntimeProvider(props: Props) {
    if (props.runtime != null) return <ProvideRuntime runtime={props.runtime}>{props.children}</ProvideRuntime>;
    return <AppRuntime>{props.children}</AppRuntime>;
}

/// The runtime over the providers of the app, it lives as long as the component
function AppRuntime(props: { children?: React.ReactNode }) {
    const logger = useLogger();
    const storage = useStorageReader();
    const http = useHttpClient();
    const setupCore = useDashQLCoreSetup();
    const resultCache = useQueryResultCache();
    const computeDatabase = useComputeDatabase();
    const salesforce = useSalesforceAPI();
    const appEvents = usePlatformEventListener();
    const platformType = usePlatformType();
    // The imports and exports of `.dashql` archives set the embedded database up when they first need it, through
    // the setup of the latest render
    const archiveDatabase = useWorkbookArchiveDatabase();
    const archiveDatabaseRef = React.useRef(archiveDatabase);
    archiveDatabaseRef.current = archiveDatabase;

    const [runtime] = React.useState(() => createRuntime({
        logger,
        storage: storage.backend,
        http: http ?? NO_HTTP,
        scheduler: FRAME_UPDATE_SCHEDULER,
        oauthFlow: new AppOAuthFlow(appEvents, platformType),
        setupCore: setupCore ?? NO_CORE,
        computeDatabase,
        resultCache,
        salesforce: salesforce ?? undefined,
        archives: handles => createRuntimeArchives(handles, context => archiveDatabaseRef.current(context)),
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

    // Write the pending changes when the page goes away, the writer debounces them. Browsers don't wait for the writes
    // when the page unloads, a hidden page usually still finishes them. Electron asks for the writes before it closes a
    // window and waits for them.
    React.useEffect(() => {
        const writer = runtime.storage;
        const flush = async () => {
            try {
                await writer.flush();
            } catch (error) {
                logger.error("Failed to flush the storage writer", { error: stringifyError(error) }, "runtime");
            }
        };
        const flushIfHidden = () => {
            if (document.visibilityState === 'hidden') void flush();
        };
        const flushOnPageHide = () => void flush();
        window.addEventListener('pagehide', flushOnPageHide);
        document.addEventListener('visibilitychange', flushIfHidden);
        const removeElectronFlush = globalThis.dashqlElectron?.onFlush(flush);
        return () => {
            window.removeEventListener('pagehide', flushOnPageHide);
            document.removeEventListener('visibilitychange', flushIfHidden);
            removeElectronFlush?.();
        };
    }, [runtime, logger]);

    // Another tab takes over the app, the pending writes finish first and nothing is written after
    useAppHandOver(async () => {
        runtime.storage.pause();
        await runtime.storage.flush();
    });

    React.useEffect(() => () => {
        void runtime.destroy().catch(error => {
            logger.error("Failed to stop the runtime", { error: stringifyError(error) }, "runtime");
        });
    }, [runtime, logger]);

    return <ProvideRuntime runtime={runtime}>{props.children}</ProvideRuntime>;
}

function ProvideRuntime(props: { runtime: Runtime; children?: React.ReactNode }) {
    return <RuntimeContextProvider value={props.runtime}>{props.children}</RuntimeContextProvider>;
}
