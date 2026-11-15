import * as React from 'react';

import { AppLoadingStatus } from './app_loading_status.js';
import { OPEN_LINK_WORKBOOK, useRouteContext, useRouterNavigate } from '../router/router.js';
import { useDashQLCoreSetup } from '../../runtime/core_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { createTrace } from '@ankoh/dashql-runtime/platform/logger/trace_context';
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';
import { usePlatformEventListener } from '../../platform/events/event_listener_provider.js';
import { SETUP_WORKBOOK, SETUP_WORKBOOK_URL, SetupEventVariant } from '../../platform/events/event.js';
import { AppHost, getAppHost } from '@ankoh/dashql-runtime/platform/native_globals';
import { useHttpClient } from '../../platform/http/http_client_provider.js';
import { readWorkbookBundleFromZip } from '@ankoh/dashql-runtime/workbook/persistence/workbook_import';
import { useWorkbookArchiveDatabase } from '../../workbook/persistence/workbook_archive_database.js';
import { useWorkbookImport } from '../../workbook/persistence/workbook_import_provider.js';
import {
    readWorkbookBundleFromHttp,
    type HttpWorkbookLoadProgress,
    type HttpWorkbookLoadResult,
} from '../../workbook/persistence/http_workbook_bundle.js';
import { WorkbookImportCard } from '../../workbook/persistence/workbook_import_card.js';

const LOG_CTX = "app_loader";

/// A shared workbook that loads from its URL
interface RemoteWorkbookLoad {
    /// The URL of the workbook
    sourceUrl: string;
    /// The progress of the load
    progress: HttpWorkbookLoadProgress;
}

/// A loaded shared workbook that waits for the user to import it
interface LoadedSharedWorkbook {
    /// The loaded workbook
    result: HttpWorkbookLoadResult;
    /// The registered workbook with the same id, if any
    conflict: { displayLocation: string; isNative: boolean } | null;
}

/// Import the workbooks that the platform hands to the app.
///
/// A deep link or an opened `.dashql` file carries the workbook itself, it is imported right away. A
/// shared URL is loaded while the app sets up and then shown in a card until the user imports it.
/// Imports wait for `setupDone` since they use the restored registries. The import of a workbook that
/// the app was started with is stored in `initialImport`, the setup doesn't open another workbook
/// when it opens one.
///
/// Returns the card of a shared workbook, null if there is none.
export function useSharedWorkbookImport(
    setupDone: Promise<void>,
    initialImport: React.RefObject<Promise<boolean> | null>,
): React.ReactElement | null {
    const logger = useLogger();
    const navigate = useRouterNavigate();
    const routeContext = useRouteContext();
    const setupCore = useDashQLCoreSetup();
    const archiveDatabase = useWorkbookArchiveDatabase();
    const appEvents = usePlatformEventListener();
    const workbookImport = useWorkbookImport();
    const httpClient = useHttpClient();

    const [remoteLoad, setRemoteLoad] = React.useState<RemoteWorkbookLoad | null>(null);
    const [loaded, setLoaded] = React.useState<LoadedSharedWorkbook | null>(null);
    const [importBusy, setImportBusy] = React.useState(false);
    const remoteAbortRef = React.useRef<AbortController | null>(null);
    React.useEffect(() => () => remoteAbortRef.current?.abort(), []);

    // Returns true if the event opened a workbook
    const consumeSetupEvent = React.useEffectEvent(async (data: SetupEventVariant): Promise<boolean> => {
        // Start trace for setup event handling
        const traced = logger.withTrace(createTrace());
        traced.debug("Consuming setup event", { "event_type": String(data.type) }, LOG_CTX);

        let remoteAbort: AbortController | null = null;
        let remoteResult: Promise<HttpWorkbookLoadResult> | null = null;
        if (data.type === SETUP_WORKBOOK_URL) {
            remoteAbortRef.current?.abort();
            remoteAbort = new AbortController();
            remoteAbortRef.current = remoteAbort;
            setRemoteLoad({ sourceUrl: data.value, progress: { phase: 'preparing' } });
            setLoaded(null);
            traced.info('Loading shared workbook', { sourceUrl: data.value }, LOG_CTX);
            remoteResult = readWorkbookBundleFromHttp(
                new URL(data.value),
                httpClient,
                remoteAbort.signal,
                progress => {
                    if (remoteAbortRef.current === remoteAbort) {
                        setRemoteLoad({ sourceUrl: data.value, progress });
                    }
                },
            );
        }

        // Remote workbook I/O can proceed while the application initializes. Import and conflict
        // detection still wait for setup because they use the initialized storage registry.
        const setup = Promise.all([setupCore("app_setup"), setupDone]);
        const result = remoteResult == null ? null : await remoteResult;
        await setup;
        remoteAbort?.signal.throwIfAborted();
        if (data.type === SETUP_WORKBOOK) {
            const zipBlob = new Blob([data.value.buffer as ArrayBuffer], { type: 'application/zip' });
            // A link imports without the user handing over a file, it never adds query results to the cache
            const { results, ...bundle } = await readWorkbookBundleFromZip(zipBlob, await archiveDatabase('workbook_import'));
            if ((results?.length ?? 0) > 0) {
                traced.warn("Ignored the query results of a link", { results: results!.length.toString() }, LOG_CTX);
            }
            const workbookId = await workbookImport.importPortableBundle(bundle, {
                presentation: { mode: 'centered' },
            });
            if (workbookId != null) {
                traced.debug("Finished link setup", { workbookId }, LOG_CTX);
                navigate({ type: OPEN_LINK_WORKBOOK, value: workbookId });
                return true;
            }
        } else if (data.type === SETUP_WORKBOOK_URL && remoteAbortRef.current === remoteAbort) {
            traced.info('Loaded shared workbook', {
                workbookId: result!.bundle.workbook.workbookId,
                loadedScriptCount: String(result!.loadedScriptCount),
                listedScriptCount: String(result!.listedScriptCount),
                incomplete: String(result!.incomplete),
            }, LOG_CTX);
            const conflict = await workbookImport.findPortableBundleConflict(result!.bundle);
            remoteAbort!.signal.throwIfAborted();
            if (remoteAbortRef.current !== remoteAbort) return false;
            traced.info('Checked shared workbook import conflict', {
                workbookId: result!.bundle.workbook.workbookId,
                conflict: String(conflict != null),
                existingLocation: conflict?.displayLocation ?? '',
            }, LOG_CTX);
            remoteAbortRef.current = null;
            setRemoteLoad(null);
            setLoaded({ result: result!, conflict });
        }
        return false;
    });

    const handleSetupEvent = React.useEffectEvent((data: SetupEventVariant) => {
        const handling = consumeSetupEvent(data).catch(error => {
            if ((error as Error)?.name === 'AbortError') return false;
            remoteAbortRef.current = null;
            setRemoteLoad(null);
            logger.error('Failed to open shared workbook', { error: stringifyError(error) }, LOG_CTX);
            return false;
        });
        // Normal startup must not replace the route selected by an inline workbook import
        if (data.type === SETUP_WORKBOOK && routeContext.appLoadingStatus === AppLoadingStatus.NOT_STARTED) {
            initialImport.current = handling;
        }
        void handling;
    });

    // Effect Events are non-reactive. Depending on handleSetupEvent would resubscribe after every
    // render even though it always reads the latest callback state.
    React.useEffect(() => {
        appEvents.subscribeSetupEvents(handleSetupEvent);
        return () => appEvents.unsubscribeSetupEvents(handleSetupEvent);
    }, [appEvents]);

    const cancelRemoteLoad = React.useCallback(() => {
        remoteAbortRef.current?.abort();
        remoteAbortRef.current = null;
        setRemoteLoad(null);
    }, []);

    const importLoaded = React.useCallback((choice?: 'replace' | 'create-new') => {
        if (loaded == null || importBusy) return;
        setImportBusy(true);
        const { result } = loaded;
        const importChoice = choice ?? 'import';
        logger.info('Importing shared workbook', {
            workbookId: result.bundle.workbook.workbookId,
            choice: importChoice,
        }, LOG_CTX);
        void workbookImport.importPortableBundleWithChoice(result.bundle, choice ?? 'create-new').then(workbookId => {
            // The user cancelled the import while choosing connections
            if (workbookId == null) return;
            logger.info('Imported shared workbook', {
                sourceWorkbookId: result.bundle.workbook.workbookId,
                workbookId,
                choice: importChoice,
            }, LOG_CTX);
            setLoaded(null);
            navigate({ type: OPEN_LINK_WORKBOOK, value: workbookId });
        }).catch(error => {
            logger.error('Failed to import loaded workbook', { error: stringifyError(error) }, LOG_CTX);
        }).finally(() => setImportBusy(false));
    }, [loaded, importBusy, logger, navigate, workbookImport]);

    const cancelLoaded = React.useCallback(() => {
        if (importBusy) return;
        setLoaded(null);
    }, [importBusy]);

    if (remoteLoad != null) {
        return <WorkbookImportCard
            phase="loading"
            sourceUrl={remoteLoad.sourceUrl}
            progress={remoteLoad.progress}
            onClose={cancelRemoteLoad}
        />;
    }
    if (loaded != null) {
        return <WorkbookImportCard
            phase="ready"
            result={loaded.result}
            conflictLocation={loaded.conflict?.displayLocation ?? null}
            conflictIsNative={getAppHost() === AppHost.ELECTRON && (loaded.conflict?.isNative ?? false)}
            busy={importBusy}
            onImport={() => importLoaded()}
            onReplace={() => importLoaded('replace')}
            onCreateNew={() => importLoaded('create-new')}
            onClose={cancelLoaded}
        />;
    }
    return null;
}
