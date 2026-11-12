import * as React from 'react';

import { DELETE_COMPUTATION } from '../compute/computation_state.js';
import { useComputationDispatch } from '../compute/computation_registry.js';
import { findWorkbookQueries, useConnectionReferences, useConnectionRegistryStore } from '../connections/connection_registry.js';
import type { ConnectionParams, WorkbookCloudLink } from '../storage/storage_backend.js';
import { useStorageReader, useStorageWriter } from '../storage/storage_provider.js';
import { workbookTablesToBundle } from '../storage/workbook_tables.js';
import type { WorkbookBundle, WorkbookBundleResult } from '../storage/workbook_bundle.js';
import { useDeleteConnection } from '../connections/connection_deletion.js';
import { IndicatorStatus } from '../ui/foundations/status_indicator.js';
import {
    cloudLoadingDetail,
    cloudLoadingDownloaded,
    cloudLoadingFailed,
    cloudLoadingStep,
    setCloudWorkbookLoading,
    startCloudLoading,
    updateCloudWorkbookLoading,
    type CloudLoadingCounts,
} from './cloud_workbook_loading.js';
import type { WorkbookImportConnectionMapping, WorkbookImportProgressConsumer } from '../workbook/persistence/workbook_import_provider.js';
import { useDashQLCoreSetup } from '../runtime/core_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { stringifyError } from '../platform/logger/logger.js';
import { SELECT_WORKBOOK, useRouteContext, useRouterNavigate } from '../app/router/router.js';
import { useWorkbookArchiveDatabase } from '../workbook/persistence/workbook_archive_database.js';
import { exportWorkbookAsSharedTables } from '../workbook/persistence/workbook_export.js';
import { useWorkbookImport } from '../workbook/persistence/workbook_import_provider.js';
import {
    isCloudPreview,
    SET_WORKBOOK_CLOUD_LINK,
    workbookCloudLink,
    type WorkbookScripts,
} from '../workbook/scripts/workbook_scripts.js';
import {
    useWorkbookScriptsDeletion,
    useWorkbookScriptsDispatch,
    useWorkbookScriptsRegistry,
    useWorkbookScriptsRegistryReader,
} from '../workbook/scripts/workbook_scripts_registry.js';
import { useCloudState } from './cloud_state.js';
import { useCloudQuery } from './cloud_query.js';
import { CloudPublishTooLargeError, deleteCloudWorkbook, listCloudWorkbookVersions, publishCloudWorkbook, readCloudWorkbook, type CloudWorkbookVersion } from './cloud_store.js';
import { retainWorkbookQueryResults } from '../workbook/persistence/workbook_query_results.js';
import { scriptRunServices } from '../workbook/scripts/script_run.js';
import { useQueryResultCache } from '../storage/query_result_cache_provider.js';
import { createCloudFolder, deleteCloudFolder, moveCloudWorkbook, renameCloudFolder, type CloudFolder } from './cloud_folders.js';

// The published workbooks of the cloud in the app: opening a version read-only, importing it, publishing a local
// workbook. See docs/design/cloud.md.
//
// A version opens like an imported file, as a workbook of its own that is linked to the published workbook. A preview
// is marked in the link: the sidebar lists it with the cloud and not with the local workbooks, and its scripts can't be
// changed. Importing a preview drops the mark, the workbook stays where it is. A preview that is left is discarded.

const LOG_CTX = 'cloud_workbooks';

/// Find the local workbook that shows a version of a published workbook, a preview or an imported one
export function findLinkedWorkbook(
    workbooks: Iterable<WorkbookScripts>,
    cloudWorkbookId: string,
    options: { versionId?: string; preview?: boolean } = {},
): WorkbookScripts | null {
    for (const workbook of workbooks) {
        const link = workbookCloudLink(workbook);
        if (link == null || link.workbookId !== cloudWorkbookId) continue;
        if (options.versionId != null && link.versionId !== options.versionId) continue;
        if (options.preview != null && isCloudPreview(workbook) !== options.preview) continue;
        return workbook;
    }
    return null;
}

/// The previews by the id of the local preview: the version it shows, the connections it registered and whether a
/// connection uses an existing one that the import would ask about. A preview that outlived the page is imported again
/// from the cloud.
interface PreviewSource {
    link: WorkbookCloudLink;
    bundle: WorkbookBundle;
    registered: string[];
    unasked: boolean;
}
const previewSources = new Map<string, PreviewSource>();
/// The previews being discarded, the cleanup and an import may both discard one
const discarding = new Set<string>();

/// Follows the loading of a version
interface CloudLoadingProgress {
    downloaded: (counts: CloudLoadingCounts) => void;
    mapped: (mapping: WorkbookImportConnectionMapping) => void;
    imported: WorkbookImportProgressConsumer;
}

/// Shows the loading of a version on the card in place of the feed
function cloudLoadingProgress(): CloudLoadingProgress {
    return {
        downloaded: counts => updateCloudWorkbookLoading(state => cloudLoadingDownloaded(state, counts)),
        mapped: mapping => updateCloudWorkbookLoading(state => {
            const total = state.steps.find(step => step.id === 'connections')?.detail ?? '';
            return mapping.registered.length === 0 ? state : cloudLoadingDetail(state, 'connections', `${total}, ${mapping.registered.length} new`);
        }),
        imported: progress => updateCloudWorkbookLoading(state => {
            switch (progress.step) {
                case 'workbook':
                    return state;
                case 'results': {
                    if (progress.outcome == null) return cloudLoadingStep(state, 'results');
                    const { added, kept, total } = progress.outcome;
                    return cloudLoadingDetail(state, 'results', `${added + kept} of ${total}`,
                        added + kept < total ? IndicatorStatus.Failed : IndicatorStatus.Succeeded);
                }
                default:
                    return cloudLoadingStep(state, progress.step);
            }
        }),
    };
}

/// The metadata of a workbook read from the cloud, linked to the version it was read from. Whatever the workbook was
/// linked to when it was published stays behind, and so does the mark of the greeter.
export function linkedWorkbookMetadata<M extends { cloud?: WorkbookCloudLink; ephemeral?: boolean }>(metadata: M, link: WorkbookCloudLink): M {
    const { cloud: _published, ephemeral: _ephemeral, ...rest } = metadata;
    return { ...rest, cloud: link } as M;
}

export interface CloudWorkbooks {
    /// Can the published workbooks be read and written? The cloud connection is online and DashQL is installed.
    ready: boolean;
    /// Open a version of a published workbook, the latest without one: read-only as a preview, or imported. Resolves
    /// the id of the local workbook, null if the import was cancelled.
    open: (cloudWorkbookId: string, options: { versionId?: string; preview: boolean; name?: string }) => Promise<string | null>;
    /// Import a preview, it becomes a local workbook that stays linked to the published workbook
    importPreview: (workbookId: string) => Promise<string | null>;
    /// Discard a preview
    discardPreview: (workbookId: string) => Promise<void>;
    /// Publish a local workbook: a new version of the published workbook it is linked to, or a new published workbook
    publish: (workbookId: string, options: { asNew: boolean }) => Promise<CloudWorkbookVersion>;
    /// Delete a published workbook, a cleanup removes it after 30 days
    remove: (cloudWorkbookId: string) => Promise<void>;
    /// The versions of a published workbook, the latest first
    listVersions: (cloudWorkbookId: string, signal?: AbortSignal) => Promise<CloudWorkbookVersion[]>;
    /// Create a folder of published workbooks
    createFolder: (name: string) => Promise<CloudFolder>;
    /// Rename a folder
    renameFolder: (folderId: string, name: string) => Promise<void>;
    /// Delete a folder, its workbooks show at the top
    deleteFolder: (folderId: string) => Promise<void>;
    /// Move a published workbook into a folder, to the top without one
    move: (cloudWorkbookId: string, folderId: string | null) => Promise<void>;
}

export function useCloudWorkbooks(): CloudWorkbooks {
    const cloud = useCloudState();
    const query = useCloudQuery(cloud.online ? cloud.connectionId : null);
    const ready = query != null && cloud.installation != null && cloud.tree != null;
    const database = cloud.database;
    const refresh = cloud.refresh;
    const archiveDatabase = useWorkbookArchiveDatabase();
    const setupCore = useDashQLCoreSetup();
    const workbookImport = useWorkbookImport();
    const navigate = useRouterNavigate();
    const readRegistry = useWorkbookScriptsRegistryReader();
    const dispatchScripts = useWorkbookScriptsDispatch();
    const deleteScripts = useWorkbookScriptsDeletion();
    const computationDispatch = useComputationDispatch();
    const connectionStore = useConnectionRegistryStore();
    const references = useConnectionReferences();
    const storageReader = useStorageReader();
    const storageWriter = useStorageWriter();
    const logger = useLogger();
    const deleteConnection = useDeleteConnection();
    const queryResultCache = useQueryResultCache();

    const discardPreview = React.useCallback(async (workbookId: string) => {
        const scripts = readRegistry().workbookScriptsMap.get(workbookId);
        if (scripts == null || !isCloudPreview(scripts) || discarding.has(workbookId)) return;
        discarding.add(workbookId);
        try {
            // The queries of the preview go with it, the connections stay
            const connections = references.connectionsOf(workbookId);
            try {
                await storageWriter.deleteWorkbook(workbookId);
            } catch (error) {
                logger.warn('Discarding a cloud preview failed', { workbookId, error: stringifyError(error) }, LOG_CTX);
                return;
            }
            deleteScripts(workbookId);
            for (const connectionId of connections) {
                const connection = connectionStore.current.connections.get(connectionId);
                if (connection == null) continue;
                for (const queryId of findWorkbookQueries(connection, workbookId)) {
                    computationDispatch({ type: DELETE_COMPUTATION, value: [queryId] });
                }
            }
            // The connections that only the preview had go with it
            for (const connectionId of previewSources.get(workbookId)?.registered ?? []) {
                if (references.workbooksOf(connectionId).some(other => other !== workbookId)) continue;
                await deleteConnection(connectionId);
            }
            previewSources.delete(workbookId);
            logger.info('Discarded a cloud preview', { workbookId }, LOG_CTX);
        } finally {
            discarding.delete(workbookId);
        }
    }, [computationDispatch, connectionStore, deleteConnection, deleteScripts, logger, readRegistry, references, storageWriter]);

    /// Read a version of a published workbook, the latest without one
    const readVersion = React.useCallback(async (cloudWorkbookId: string, versionId?: string) => {
        if (query == null) throw new Error('The cloud connection is not online');
        const local = await archiveDatabase('cloud_read');
        const { version, tables } = await readCloudWorkbook(query, local, cloudWorkbookId, { database, versionId });
        return { version, bundle: await workbookTablesToBundle(tables, 'Invalid cloud workbook') };
    }, [archiveDatabase, database, query]);

    /// Import a version as a local workbook of its own, linked to the version, with its query results. The import maps
    /// its connections to the connections of the app, a preview asks nothing.
    const importVersion = React.useCallback(async (
        bundle: WorkbookBundle,
        link: WorkbookCloudLink,
        onConnections?: (mapping: WorkbookImportConnectionMapping) => void,
        onProgress?: WorkbookImportProgressConsumer,
    ) => {
        // Every version opens as a workbook of its own, an id of a local workbook never clashes with it
        const workbookId = crypto.randomUUID();
        return await workbookImport.importPortableBundle({
            ...bundle,
            workbook: { ...bundle.workbook, workbookId, metadata: linkedWorkbookMetadata(bundle.workbook.metadata, link) },
        }, { presentation: { mode: 'centered' }, connections: link.preview ? 'preview' : 'ask', onConnections, onProgress });
    }, [workbookImport]);

    /// Download a version and import it, as a preview or as a local workbook
    const openVersion = React.useCallback(async (
        cloudWorkbookId: string,
        options: { versionId?: string; preview: boolean },
        progress: CloudLoadingProgress,
    ) => {
        if (query == null) throw new Error('The cloud connection is not online');
        const workbooks = [...readRegistry().workbookScriptsMap.values()];
        // A preview of the version is shown again
        const shown = options.preview && options.versionId != null
            ? findLinkedWorkbook(workbooks, cloudWorkbookId, { versionId: options.versionId, preview: true })
            : null;
        if (shown != null) {
            navigate({ type: SELECT_WORKBOOK, value: shown.workbookId });
            return shown.workbookId;
        }
        const { version, bundle } = await readVersion(cloudWorkbookId, options.versionId);
        progress.downloaded({
            version: version.version,
            connections: bundle.workbook.connections.length,
            results: bundle.results?.length ?? 0,
            scripts: bundle.scripts.length,
            attachments: bundle.data?.length ?? 0,
        });
        if (options.preview) {
            const again = findLinkedWorkbook(readRegistry().workbookScriptsMap.values(), cloudWorkbookId, { versionId: version.versionId, preview: true });
            if (again != null) {
                navigate({ type: SELECT_WORKBOOK, value: again.workbookId });
                return again.workbookId;
            }
        }
        const link: WorkbookCloudLink = { workbookId: cloudWorkbookId, versionId: version.versionId };
        let imported: string | null;
        if (options.preview) {
            // A preview keeps the connections of the version, the ones the app doesn't have are registered for it
            let mapping: WorkbookImportConnectionMapping = { registered: [], unasked: false };
            imported = await importVersion(bundle, { ...link, preview: true }, decided => { mapping = decided; progress.mapped(decided); }, progress.imported);
            if (imported != null) previewSources.set(imported, { link, bundle, ...mapping });
        } else {
            imported = await importVersion(bundle, link, progress.mapped, progress.imported);
        }
        if (imported == null) return null;
        logger.info('Opened a published workbook', {
            workbookId: imported, cloudWorkbookId, versionId: version.versionId, preview: String(options.preview),
        }, LOG_CTX);
        navigate({ type: SELECT_WORKBOOK, value: imported });
        // One preview at a time, the others were left
        if (options.preview) {
            for (const other of readRegistry().workbookScriptsMap.values()) {
                if (other.workbookId !== imported && isCloudPreview(other)) await discardPreview(other.workbookId);
            }
        }
        return imported;
    }, [discardPreview, importVersion, logger, navigate, query, readRegistry, readVersion]);

    const open = React.useCallback(async (cloudWorkbookId: string, options: { versionId?: string; preview: boolean; name?: string }) => {
        setCloudWorkbookLoading(startCloudLoading(options.name ?? 'Untitled', options.preview));
        try {
            const opened = await openVersion(cloudWorkbookId, options, cloudLoadingProgress());
            setCloudWorkbookLoading(null);
            return opened;
        } catch (error) {
            // The card stays with the step that failed until it is closed
            updateCloudWorkbookLoading(state => cloudLoadingFailed(state, error instanceof Error ? error.message : String(error)));
            throw error;
        }
    }, [openVersion]);

    /// Import a preview as a local workbook. A preview whose connections map without a question becomes the local
    /// workbook, it only loses its mark. Otherwise the version is imported again, now asking about the connections, and
    /// the preview is discarded.
    const importPreview = React.useCallback(async (workbookId: string) => {
        const scripts = readRegistry().workbookScriptsMap.get(workbookId);
        const link = scripts == null ? null : workbookCloudLink(scripts);
        if (link == null || !link.preview) return null;
        const versionLink = { workbookId: link.workbookId, versionId: link.versionId };
        const source = previewSources.get(workbookId);
        if (source != null && !source.unasked) {
            await dispatchScripts(workbookId, { type: SET_WORKBOOK_CLOUD_LINK, value: versionLink });
            previewSources.delete(workbookId);
            logger.info('Imported a cloud preview', { workbookId, cloudWorkbookId: link.workbookId, versionId: link.versionId }, LOG_CTX);
            return workbookId;
        }
        const bundle = source?.bundle ?? (await readVersion(link.workbookId, link.versionId)).bundle;
        const imported = await importVersion(bundle, versionLink);
        if (imported == null) return null;
        logger.info('Imported a cloud preview again', { workbookId: imported, preview: workbookId, cloudWorkbookId: link.workbookId, versionId: link.versionId }, LOG_CTX);
        navigate({ type: SELECT_WORKBOOK, value: imported });
        await discardPreview(workbookId);
        return imported;
    }, [discardPreview, dispatchScripts, importVersion, logger, navigate, readRegistry, readVersion]);

    const publish = React.useCallback(async (workbookId: string, options: { asNew: boolean }) => {
        if (query == null) throw new Error('The cloud connection is not online');
        const scripts = readRegistry().workbookScriptsMap.get(workbookId);
        if (scripts == null) throw new Error(`Unknown workbook ${workbookId}`);
        if (isCloudPreview(scripts)) throw new Error('A preview of a published workbook is imported before it is published');
        const link = workbookCloudLink(scripts);
        // The export reads the workbook from the storage
        await storageWriter.flushWorkbook(workbookId);
        const connectionParams = new Map<string, ConnectionParams>();
        const connectionNames = new Map<string, string>();
        for (const connectionId of references.connectionsOf(workbookId)) {
            const connection = connectionStore.current.connections.get(connectionId);
            if (connection?.params != null) connectionParams.set(connectionId, connection.params);
            if (connection?.name != null) connectionNames.set(connectionId, connection.name);
        }
        const core = await setupCore('cloud_publish');
        const local = await archiveDatabase('cloud_publish');
        const cloudWorkbookId = options.asNew ? undefined : link?.workbookId;
        // The cached results go along, a preview shows them for the connections that it doesn't run on. They stay
        // pinned until the publish sent them.
        const retained = queryResultCache == null ? null : await retainWorkbookQueryResults(scriptRunServices(scripts.instance), scripts, queryResultCache);
        let version: CloudWorkbookVersion;
        try {
            // Whoever opens the workbook logs in to the connections with their own account
            const exportTables = (queryResults?: readonly WorkbookBundleResult[]) => exportWorkbookAsSharedTables(storageReader.backend, core, workbookId, connectionParams, {
                withCatalog: true, withLoginHint: false, connectionNames, queryResults,
            });
            try {
                version = await publishCloudWorkbook(query, local, await exportTables(retained?.results), { database, workbookId: cloudWorkbookId });
            } catch (error) {
                if (!(error instanceof CloudPublishTooLargeError) || (retained?.results.length ?? 0) === 0) throw error;
                logger.warn('The query results are too large to publish, publishing without them', { workbookId, error: stringifyError(error) }, LOG_CTX);
                version = await publishCloudWorkbook(query, local, await exportTables(), { database, workbookId: cloudWorkbookId });
            }
        } finally {
            await retained?.release();
        }
        await dispatchScripts(workbookId, {
            type: SET_WORKBOOK_CLOUD_LINK,
            value: { workbookId: version.workbookId, versionId: version.versionId },
        });
        logger.info('Published a workbook', {
            workbookId, cloudWorkbookId: version.workbookId, versionId: version.versionId, version: String(version.version),
            results: String(retained?.results.length ?? 0),
        }, LOG_CTX);
        await refresh();
        return version;
    }, [archiveDatabase, connectionStore, database, dispatchScripts, logger, query, queryResultCache, readRegistry, references, refresh, setupCore, storageReader, storageWriter]);

    const remove = React.useCallback(async (cloudWorkbookId: string) => {
        if (query == null) throw new Error('The cloud connection is not online');
        await deleteCloudWorkbook(query, cloudWorkbookId, { database });
        logger.info('Deleted a published workbook', { cloudWorkbookId }, LOG_CTX);
        await refresh();
    }, [database, logger, query, refresh]);

    const listVersions = React.useCallback(async (cloudWorkbookId: string, signal?: AbortSignal) => {
        if (query == null) return [];
        return await listCloudWorkbookVersions(query, cloudWorkbookId, { database, signal });
    }, [database, query]);

    // The folders change the tree, the cloud is listed again after each change
    const createFolder = React.useCallback(async (name: string) => {
        if (query == null) throw new Error('The cloud connection is not online');
        const folder = await createCloudFolder(query, name, { database });
        logger.info('Created a cloud folder', { folderId: folder.folderId }, LOG_CTX);
        await refresh();
        return folder;
    }, [database, logger, query, refresh]);
    const renameFolder = React.useCallback(async (folderId: string, name: string) => {
        if (query == null) throw new Error('The cloud connection is not online');
        await renameCloudFolder(query, folderId, name, { database });
        await refresh();
    }, [database, query, refresh]);
    const deleteFolder = React.useCallback(async (folderId: string) => {
        if (query == null) throw new Error('The cloud connection is not online');
        await deleteCloudFolder(query, folderId, { database });
        logger.info('Deleted a cloud folder', { folderId }, LOG_CTX);
        await refresh();
    }, [database, logger, query, refresh]);
    const move = React.useCallback(async (cloudWorkbookId: string, folderId: string | null) => {
        if (query == null) throw new Error('The cloud connection is not online');
        await moveCloudWorkbook(query, cloudWorkbookId, folderId, { database });
        logger.info('Moved a published workbook', { cloudWorkbookId, folderId: folderId ?? 'top' }, LOG_CTX);
        await refresh();
    }, [database, logger, query, refresh]);

    return React.useMemo(() => ({ ready, open, importPreview, discardPreview, publish, remove, listVersions, createFolder, renameFolder, deleteFolder, move }),
        [ready, open, importPreview, discardPreview, publish, remove, listVersions, createFolder, renameFolder, deleteFolder, move]);
}

/// Discard a preview once another workbook is shown. A preview that was never shown is left alone, it may just have
/// been opened and the navigation to it is on its way.
export function useCloudPreviewCleanup(currentWorkbookId: string | null, workbooks: Iterable<WorkbookScripts>, discard: (workbookId: string) => Promise<void>): void {
    const shown = React.useRef(new Set<string>());
    const previews = [...workbooks].filter(isCloudPreview).map(workbook => workbook.workbookId);
    const previewKey = previews.join(',');
    React.useEffect(() => {
        if (currentWorkbookId == null) return;
        if (previews.includes(currentWorkbookId)) shown.current.add(currentWorkbookId);
        for (const workbookId of previews) {
            if (workbookId !== currentWorkbookId && shown.current.has(workbookId)) {
                shown.current.delete(workbookId);
                void discard(workbookId);
            }
        }
    }, [currentWorkbookId, previewKey, discard]);
}

/// Discards the cloud previews that were left, once for the app
export const CloudPreviewCleanup: React.FC = () => {
    const route = useRouteContext();
    const [registry] = useWorkbookScriptsRegistry();
    const { discardPreview } = useCloudWorkbooks();
    useCloudPreviewCleanup(route.workbookId, registry.workbookScriptsMap.values(), discardPreview);
    return null;
};
