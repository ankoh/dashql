import * as React from 'react';

import { useDeleteComputation } from '../runtime/runtime_hooks.js';
import { findWorkbookQueries, useConnectionReferences, useConnectionRegistryStore, type ConnectionReferences } from '../connections/connection_registry.js';
import type { ConnectionParams, WorkbookCloudLink } from '@ankoh/dashql-runtime/storage/storage_backend';
import { useStorageReader, useStorageWriter } from '../storage/storage_provider.js';
import { workbookTablesToBundle } from '@ankoh/dashql-runtime/storage/workbook_tables';
import type { WorkbookBundle, WorkbookBundleResult } from '@ankoh/dashql-runtime/storage/workbook_bundle';
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
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';
import { SELECT_WORKBOOK, useRouteContext, useRouterNavigate } from '../app/router/router.js';
import { useWorkbookArchiveDatabase } from '../workbook/persistence/workbook_archive_database.js';
import { exportWorkbookAsSharedTables } from '@ankoh/dashql-runtime/workbook/persistence/workbook_export';
import { useWorkbookImport } from '../workbook/persistence/workbook_import_provider.js';
import {
    isCloudPreview,
    SET_WORKBOOK_CLOUD_LINK,
    workbookCloudLink,
    type WorkbookScripts,
} from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import {
    useWorkbookScriptsDeletion,
    useWorkbookScriptsDispatch,
    useWorkbookScriptsRegistry,
    useWorkbookScriptsRegistryReader,
} from '../workbook/scripts/workbook_scripts_registry.js';
import { useClouds, type CloudState } from './cloud_state.js';
import { useCloudQueries } from './cloud_query.js';
import { trackCloudPublish } from './cloud_publish_status.js';
import { CloudPublishTooLargeError, deleteCloudWorkbook, listCloudWorkbookVersions, publishCloudWorkbook, readCloudWorkbook, type CloudWorkbookVersion } from './cloud_store.js';
import type { CloudQuery } from './cloud_store_schema.js';
import { retainWorkbookQueryResults } from '@ankoh/dashql-runtime/workbook/persistence/workbook_query_results';
import { scriptRunServices } from '@ankoh/dashql-runtime/workbook/scripts/script_run';
import { useQueryResultCache } from '../storage/query_result_cache_provider.js';
import {
    createCloudFolder,
    deleteCloudFolder,
    listCloudEntries,
    moveCloudFolder,
    moveCloudWorkbook,
    readCloudFolderPath,
    renameCloudFolder,
    type CloudFolder,
    type CloudListRequest,
    type CloudPage,
} from './cloud_folders.js';

// The published workbooks of the cloud in the app: opening a version read-only, importing it, publishing a local
// workbook. See docs/design/cloud.md.
//
// A version opens like an imported file, as a workbook of its own that is linked to the published workbook and its
// cloud. A preview is marked in the link: the sidebar lists it with its cloud and not with the local workbooks, and its
// scripts can't be changed. Importing a preview drops the mark, the workbook stays where it is. A preview that is left
// is discarded. The app may have several clouds, every call names the cloud it goes to.

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

/// The previews by the id of the local preview: the version it shows and whether a connection uses an existing one
/// that the import would ask about. A preview that outlived the page is imported again from the cloud.
interface PreviewSource {
    link: WorkbookCloudLink;
    bundle: WorkbookBundle;
    unasked: boolean;
}
const previewSources = new Map<string, PreviewSource>();
/// The previews being discarded, the cleanup and an import may both discard one
const discarding = new Set<string>();

/// The connections that a preview registered: those it uses that no other workbook uses and that the app manifest
/// doesn't keep. A preview links only to connections of the manifest and registers the others, its files keep them, so
/// this holds after a reload as well.
export function previewConnections(workbookId: string, used: readonly string[], kept: ReadonlySet<string>, references: ConnectionReferences): string[] {
    return used.filter(connectionId => !kept.has(connectionId) && references.workbooksOf(connectionId).every(other => other === workbookId));
}

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
    /// Can the published workbooks of a cloud be read and written? Its connection is online and DashQL is installed.
    isReady: (cloudId: string) => boolean;
    /// Open a version of a published workbook, the latest without one: read-only as a preview, or imported. Resolves
    /// the id of the local workbook, null if the import was cancelled.
    open: (cloudId: string, cloudWorkbookId: string, options: { versionId?: string; preview: boolean; name?: string }) => Promise<string | null>;
    /// Import a preview, it becomes a local workbook that stays linked to the published workbook
    importPreview: (workbookId: string) => Promise<string | null>;
    /// Discard a preview
    discardPreview: (workbookId: string) => Promise<void>;
    /// Publish a local workbook to a cloud: a new version of the published workbook it is linked to if that is in the
    /// cloud, otherwise a new published workbook
    publish: (workbookId: string, options: { cloudId: string; asNew: boolean; folderId?: string | null }) => Promise<CloudWorkbookVersion>;
    /// Delete a published workbook, a cleanup removes it after 30 days
    remove: (cloudId: string, cloudWorkbookId: string) => Promise<void>;
    /// A page of the folders and workbooks of a folder, or of the workbooks that a search finds
    list: (cloudId: string, request: CloudListRequest, signal?: AbortSignal) => Promise<CloudPage>;
    /// The folders from the top down to a folder, the folder last
    folderPath: (cloudId: string, folderId: string, signal?: AbortSignal) => Promise<CloudFolder[]>;
    /// The versions of a published workbook, the latest first
    listVersions: (cloudId: string, cloudWorkbookId: string, signal?: AbortSignal) => Promise<CloudWorkbookVersion[]>;
    /// Create a folder of published workbooks in a folder, at the top without one
    createFolder: (cloudId: string, name: string, parentId: string | null) => Promise<CloudFolder>;
    /// Rename a folder
    renameFolder: (cloudId: string, folderId: string, name: string) => Promise<void>;
    /// Delete a folder, its folders and workbooks move to its parent
    deleteFolder: (cloudId: string, folderId: string) => Promise<void>;
    /// Move a published workbook into a folder, to the top without one
    move: (cloudId: string, cloudWorkbookId: string, folderId: string | null) => Promise<void>;
    /// Move a folder into another one, to the top without one
    moveFolder: (cloudId: string, folderId: string, parentId: string | null) => Promise<void>;
}

/// A cloud that can be read and written, with its statements
interface ReadyCloud {
    cloud: CloudState;
    query: CloudQuery;
    database: string;
}

export function useCloudWorkbooks(): CloudWorkbooks {
    const { clouds } = useClouds();
    const queryOf = useCloudQueries();
    // The clouds by id, read by the calls when they run
    const cloudsRef = React.useRef(clouds);
    cloudsRef.current = clouds;
    const isReady = React.useCallback((cloudId: string) => {
        const cloud = clouds.find(candidate => candidate.connectionId === cloudId);
        return cloud != null && cloud.online && cloud.readable;
    }, [clouds]);
    /// The cloud of a call, it has to be online
    const readyCloud = React.useCallback((cloudId: string): ReadyCloud => {
        const cloud = cloudsRef.current.find(candidate => candidate.connectionId === cloudId);
        if (cloud == null) throw new Error('The connection is no cloud');
        if (!cloud.online) throw new Error(cloud.connection.name == null ? 'The cloud is not online' : `The cloud ${cloud.connection.name} is not online`);
        return { cloud, query: queryOf(cloudId), database: cloud.database };
    }, [queryOf]);
    const archiveDatabase = useWorkbookArchiveDatabase();
    const setupCore = useDashQLCoreSetup();
    const workbookImport = useWorkbookImport();
    const navigate = useRouterNavigate();
    const readRegistry = useWorkbookScriptsRegistryReader();
    const dispatchScripts = useWorkbookScriptsDispatch();
    const deleteScripts = useWorkbookScriptsDeletion();
    const deleteComputation = useDeleteComputation();
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
                    deleteComputation(queryId);
                }
            }
            // The connections that the preview registered go with it
            const manifest = storageReader.workbookFolders == null ? null : await storageReader.workbookFolders.loadManifest();
            const kept = new Set<string>((manifest?.connections ?? []).map(entry => entry.id));
            for (const connectionId of previewConnections(workbookId, connections, kept, references)) {
                await deleteConnection(connectionId);
            }
            previewSources.delete(workbookId);
            logger.info('Discarded a cloud preview', { workbookId }, LOG_CTX);
        } finally {
            discarding.delete(workbookId);
        }
    }, [deleteComputation, connectionStore, deleteConnection, deleteScripts, logger, readRegistry, references, storageReader, storageWriter]);

    /// Read a version of a published workbook, the latest without one
    const readVersion = React.useCallback(async (cloudId: string, cloudWorkbookId: string, versionId?: string) => {
        const { query, database } = readyCloud(cloudId);
        const local = await archiveDatabase('cloud_read');
        const { version, tables } = await readCloudWorkbook(query, local, cloudWorkbookId, { database, versionId });
        return { version, bundle: await workbookTablesToBundle(tables, 'Invalid cloud workbook') };
    }, [archiveDatabase, readyCloud]);

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
        cloudId: string,
        cloudWorkbookId: string,
        options: { versionId?: string; preview: boolean },
        progress: CloudLoadingProgress,
    ) => {
        readyCloud(cloudId);
        const workbooks = [...readRegistry().workbookScriptsMap.values()];
        // A preview of the version is shown again
        const shown = options.preview && options.versionId != null
            ? findLinkedWorkbook(workbooks, cloudWorkbookId, { versionId: options.versionId, preview: true })
            : null;
        if (shown != null) {
            navigate({ type: SELECT_WORKBOOK, value: shown.workbookId });
            return shown.workbookId;
        }
        const { version, bundle } = await readVersion(cloudId, cloudWorkbookId, options.versionId);
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
        const link: WorkbookCloudLink = { workbookId: cloudWorkbookId, versionId: version.versionId, connectionId: cloudId };
        let imported: string | null;
        if (options.preview) {
            // A preview keeps the connections of the version, the ones the app doesn't have are registered for it
            let mapping: WorkbookImportConnectionMapping = { registered: [], unasked: false };
            imported = await importVersion(bundle, { ...link, preview: true }, decided => { mapping = decided; progress.mapped(decided); }, progress.imported);
            if (imported != null) previewSources.set(imported, { link, bundle, unasked: mapping.unasked });
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
    }, [discardPreview, importVersion, logger, navigate, readRegistry, readVersion, readyCloud]);

    const open = React.useCallback(async (cloudId: string, cloudWorkbookId: string, options: { versionId?: string; preview: boolean; name?: string }) => {
        setCloudWorkbookLoading(startCloudLoading(options.name ?? 'Untitled', options.preview));
        try {
            const opened = await openVersion(cloudId, cloudWorkbookId, options, cloudLoadingProgress());
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
        const cloudId = link.connectionId;
        const versionLink: WorkbookCloudLink = { workbookId: link.workbookId, versionId: link.versionId, connectionId: cloudId };
        const source = previewSources.get(workbookId);
        if (source != null && !source.unasked) {
            await dispatchScripts(workbookId, { type: SET_WORKBOOK_CLOUD_LINK, value: versionLink });
            previewSources.delete(workbookId);
            logger.info('Imported a cloud preview', { workbookId, cloudWorkbookId: link.workbookId, versionId: link.versionId }, LOG_CTX);
            return workbookId;
        }
        const bundle = source?.bundle ?? (await readVersion(cloudId, link.workbookId, link.versionId)).bundle;
        const imported = await importVersion(bundle, versionLink);
        if (imported == null) return null;
        logger.info('Imported a cloud preview again', { workbookId: imported, preview: workbookId, cloudWorkbookId: link.workbookId, versionId: link.versionId }, LOG_CTX);
        navigate({ type: SELECT_WORKBOOK, value: imported });
        await discardPreview(workbookId);
        return imported;
    }, [discardPreview, dispatchScripts, importVersion, logger, navigate, readRegistry, readVersion]);

    const publishVersion = React.useCallback(async (workbookId: string, options: { cloudId: string; asNew: boolean; folderId?: string | null }) => {
        const { cloud, query, database } = readyCloud(options.cloudId);
        const scripts = readRegistry().workbookScriptsMap.get(workbookId);
        if (scripts == null) throw new Error(`Unknown workbook ${workbookId}`);
        if (isCloudPreview(scripts)) throw new Error('A preview of a published workbook is imported before it is published');
        const link = workbookCloudLink(scripts);
        // A new version goes to the published workbook of the link only in its own cloud
        const linkedHere = link?.connectionId === options.cloudId;
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
        const cloudWorkbookId = options.asNew || !linkedHere ? undefined : link?.workbookId;
        const folderId = options.folderId ?? undefined;
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
                version = await publishCloudWorkbook(query, local, await exportTables(retained?.results), { database, workbookId: cloudWorkbookId, folderId });
            } catch (error) {
                if (!(error instanceof CloudPublishTooLargeError) || (retained?.results.length ?? 0) === 0) throw error;
                logger.warn('The query results are too large to publish, publishing without them', { workbookId, error: stringifyError(error) }, LOG_CTX);
                version = await publishCloudWorkbook(query, local, await exportTables(), { database, workbookId: cloudWorkbookId, folderId });
            }
        } finally {
            await retained?.release();
        }
        await dispatchScripts(workbookId, {
            type: SET_WORKBOOK_CLOUD_LINK,
            value: { workbookId: version.workbookId, versionId: version.versionId, connectionId: options.cloudId },
        });
        logger.info('Published a workbook', {
            workbookId, cloudId: options.cloudId, cloudWorkbookId: version.workbookId, versionId: version.versionId, version: String(version.version),
            results: String(retained?.results.length ?? 0),
        }, LOG_CTX);
        await cloud.refresh();
        return version;
    }, [archiveDatabase, connectionStore, dispatchScripts, logger, queryResultCache, readRegistry, readyCloud, references, setupCore, storageReader, storageWriter]);
    // The status of the workbook tells the publish
    const publish = React.useCallback(
        (workbookId: string, options: Parameters<typeof publishVersion>[1]) => trackCloudPublish(workbookId, publishVersion(workbookId, options)),
        [publishVersion],
    );

    /// Run a change of a cloud and look at the cloud again, its listings read again
    const change = React.useCallback(async <T>(cloudId: string, run: (cloud: ReadyCloud) => Promise<T>): Promise<T> => {
        const ready = readyCloud(cloudId);
        try {
            return await run(ready);
        } finally {
            await ready.cloud.refresh();
        }
    }, [readyCloud]);

    const remove = React.useCallback((cloudId: string, cloudWorkbookId: string) => change(cloudId, async ({ query, database }) => {
        await deleteCloudWorkbook(query, cloudWorkbookId, { database });
        logger.info('Deleted a published workbook', { cloudId, cloudWorkbookId }, LOG_CTX);
    }), [change, logger]);

    const list = React.useCallback(async (cloudId: string, request: CloudListRequest, signal?: AbortSignal) => {
        const { query, database } = readyCloud(cloudId);
        return await listCloudEntries(query, request, { database, signal });
    }, [readyCloud]);
    const folderPath = React.useCallback(async (cloudId: string, folderId: string, signal?: AbortSignal) => {
        const { query, database } = readyCloud(cloudId);
        return await readCloudFolderPath(query, folderId, { database, signal });
    }, [readyCloud]);
    const listVersions = React.useCallback(async (cloudId: string, cloudWorkbookId: string, signal?: AbortSignal) => {
        const { query, database } = readyCloud(cloudId);
        return await listCloudWorkbookVersions(query, cloudWorkbookId, { database, signal });
    }, [readyCloud]);

    // A change of the folders is followed by a look at the cloud, its listings read again
    const createFolder = React.useCallback((cloudId: string, name: string, parentId: string | null) => change(cloudId, async ({ query, database }) => {
        const folder = await createCloudFolder(query, name, parentId, { database });
        logger.info('Created a cloud folder', { cloudId, folderId: folder.folderId }, LOG_CTX);
        return folder;
    }), [change, logger]);
    const renameFolder = React.useCallback((cloudId: string, folderId: string, name: string) => change(cloudId, async ({ query, database }) => {
        await renameCloudFolder(query, folderId, name, { database });
    }), [change]);
    const deleteFolder = React.useCallback((cloudId: string, folderId: string) => change(cloudId, async ({ query, database }) => {
        await deleteCloudFolder(query, folderId, { database });
        logger.info('Deleted a cloud folder', { cloudId, folderId }, LOG_CTX);
    }), [change, logger]);
    const move = React.useCallback((cloudId: string, cloudWorkbookId: string, folderId: string | null) => change(cloudId, async ({ query, database }) => {
        await moveCloudWorkbook(query, cloudWorkbookId, folderId, { database });
        logger.info('Moved a published workbook', { cloudId, cloudWorkbookId, folderId: folderId ?? 'top' }, LOG_CTX);
    }), [change, logger]);
    const moveFolder = React.useCallback((cloudId: string, folderId: string, parentId: string | null) => change(cloudId, async ({ query, database }) => {
        await moveCloudFolder(query, folderId, parentId, { database });
        logger.info('Moved a cloud folder', { cloudId, folderId, parentId: parentId ?? 'top' }, LOG_CTX);
    }), [change, logger]);

    return React.useMemo(() => ({
        isReady, open, importPreview, discardPreview, publish, remove, list, folderPath, listVersions, createFolder, renameFolder, deleteFolder, move, moveFolder,
    }), [isReady, open, importPreview, discardPreview, publish, remove, list, folderPath, listVersions, createFolder, renameFolder, deleteFolder, move, moveFolder]);
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
