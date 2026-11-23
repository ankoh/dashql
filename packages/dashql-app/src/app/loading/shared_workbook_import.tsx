import * as React from 'react';

import { OPEN_IMPORTED_WORKBOOK, useRouteContext, useRouterNavigate } from '../router.js';
import { useDashQLCoreSetup } from '../../host/core_provider.js';
import { useLogger } from '../../host/logger_provider.js';
import { createTrace } from '@akohn/dashql/platform/logger/trace_context';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { usePlatformEventListener } from '../../host/events/event_listener_provider.js';
import { SETUP_WORKBOOK, SETUP_WORKBOOK_URL, SetupEventVariant } from '../../host/events/event.js';
import { AppHost, getAppHost } from '@akohn/dashql-react/dom/app_host';
import { useHttpClient } from '../../host/http/http_client_provider.js';
import { importConflictOf, importedWorkbook, useWorkbookImport } from '../../workbook/persistence/workbook_import_provider.js';
import {
    readWorkbookFromHttp,
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
        // Remote workbook I/O can proceed while the application initializes. Reading the import and detecting a
        // conflict wait for the setup because they use the initialized storage registry.
        const setup = Promise.all([setupCore("app_setup"), setupDone]);
        if (data.type === SETUP_WORKBOOK_URL) {
            remoteAbortRef.current?.abort();
            remoteAbort = new AbortController();
            remoteAbortRef.current = remoteAbort;
            setRemoteLoad({ sourceUrl: data.value, progress: { phase: 'preparing' } });
            setLoaded(null);
            traced.info('Loading shared workbook', { sourceUrl: data.value }, LOG_CTX);
            remoteResult = readWorkbookFromHttp(
                new URL(data.value),
                httpClient,
                // The workbook folder is read once the app set up, the import needs the restored storage
                async source => {
                    await setup;
                    return await workbookImport.readImport(source);
                },
                remoteAbort.signal,
                progress => {
                    if (remoteAbortRef.current === remoteAbort) {
                        setRemoteLoad({ sourceUrl: data.value, progress });
                    }
                },
            );
        }

        const result = remoteResult == null ? null : await remoteResult;
        await setup;
        if (remoteAbort?.signal.aborted) {
            if (result != null) workbookImport.dropImport(result.preview);
            remoteAbort.signal.throwIfAborted();
        }
        if (data.type === SETUP_WORKBOOK) {
            const zipBlob = new Blob([data.value.buffer as ArrayBuffer], { type: 'application/zip' });
            // A link imports without the user handing over a file, it never adds query results to the cache
            const workbookId = await workbookImport.importWorkbook({ archive: zipBlob }, {
                presentation: { mode: 'centered' },
                results: false,
            });
            if (workbookId != null) {
                traced.debug("Finished link setup", { workbookId }, LOG_CTX);
                navigate({ type: OPEN_IMPORTED_WORKBOOK, value: workbookId });
                return true;
            }
        } else if (data.type === SETUP_WORKBOOK_URL && result != null && remoteAbortRef.current !== remoteAbort) {
            // A newer shared workbook replaced this one
            workbookImport.dropImport(result.preview);
        } else if (data.type === SETUP_WORKBOOK_URL && remoteAbortRef.current === remoteAbort) {
            const workbookId = importedWorkbook(result!.preview).workbookId;
            traced.info('Loaded shared workbook', {
                workbookId,
                loadedScriptCount: String(result!.loadedScriptCount),
                listedScriptCount: String(result!.listedScriptCount),
                incomplete: String(result!.incomplete),
            }, LOG_CTX);
            const conflict = importConflictOf(result!.preview);
            traced.info('Checked shared workbook import conflict', {
                workbookId,
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
        if (data.type === SETUP_WORKBOOK && !routeContext.setupDone) {
            initialImport.current = handling;
        }
        void handling;
    });

    // Effect Events are non-reactive. Depending on handleSetupEvent would resubscribe after every
    // render even though it always reads the latest callback state.
    React.useEffect(() => appEvents.subscribeSetupEvents(handleSetupEvent), [appEvents]);

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
        const sourceWorkbookId = importedWorkbook(result.preview).workbookId;
        logger.info('Importing shared workbook', {
            workbookId: sourceWorkbookId,
            choice: importChoice,
        }, LOG_CTX);
        const run = async () => {
            const prepared = await workbookImport.prepareImport(result.preview);
            // The user cancelled the import while choosing connections, the import is dropped
            if (prepared == null) {
                setLoaded(null);
                return null;
            }
            return await workbookImport.commitImport(prepared, choice ?? 'create-new');
        };
        void run().then(workbookId => {
            if (workbookId == null) return;
            logger.info('Imported shared workbook', {
                sourceWorkbookId,
                workbookId,
                choice: importChoice,
            }, LOG_CTX);
            setLoaded(null);
            navigate({ type: OPEN_IMPORTED_WORKBOOK, value: workbookId });
        }).catch(error => {
            logger.error('Failed to import loaded workbook', { error: stringifyError(error) }, LOG_CTX);
        }).finally(() => setImportBusy(false));
    }, [loaded, importBusy, logger, navigate, workbookImport]);

    const cancelLoaded = React.useCallback(() => {
        if (importBusy || loaded == null) return;
        workbookImport.dropImport(loaded.result.preview);
        setLoaded(null);
    }, [importBusy, loaded, workbookImport]);

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
