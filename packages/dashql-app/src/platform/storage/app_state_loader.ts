import type { DashQL } from '../../core/api.js';
import type { Logger } from '../logger/logger.js';
import { stringifyError } from '../logger/logger.js';
import { ProgressCounter } from '../../utils/progress.js';
import type { ConnectionState } from '../../connection/connection_state.js';
import type { NotebookScripts, ScriptData } from '../../scripts/notebook_scripts.js';
import { analyzeAllScripts, createEmptyScriptData, destroyNotebookScripts, sortScriptFolderNamesNumerically } from '../../scripts/notebook_scripts.js';
import type { AnalyzeAllScriptsProgress } from '../../scripts/notebook_scripts.js';
import { decodeConnectionFromProto, restoreConnectionState } from '../../connection/connection_import.js';
import { ConnectorType, type ConnectorInfo } from '../../connection/connector_info.js';
import type { StorageBackend, NotebookEntry, NotebookData, ScriptFolderData } from './storage_backend.js';
import { StorageBackendType } from './storage_backend.js';
import { validateNotebookData, describeInvalidNotebook, isValidUuid, NotebookValidationError, type InvalidNotebook } from './notebook_validation.js';
import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from '../../connection/catalog_update_state.js';
import { createEmptyAnnotations } from '../../scripts/script_types.js';
import * as Immutable from 'immutable';

const LOG_CTX = "app_state_loader";

export interface RestoredAppState {
    connectionStates: Map<string, ConnectionState>;
    connectionStatesByType: string[][];
    connectionSignatures: Map<string, string | null>;
    notebookScripts: Map<string, NotebookScripts>;
    notebookScriptsByConnection: Map<string, string>;
    notebookScriptsByConnectionType: string[][];
    /// Notebooks whose metadata failed validation and were refused a load (keyed by bare UUID).
    /// These never enter the connection/notebook maps; the notebook selector surfaces them as
    /// invalid (blocked from opening, still deletable).
    invalidNotebooks: Map<string, InvalidNotebook>;
}

/// Thrown by `restoreNotebookEntry` when a notebook's metadata fails the up-front validation gate.
///
/// Distinguished from an arbitrary restore error so the loader can record it as a (skipped)
/// invalid notebook and surface it in the UI, rather than counting it as a hard failure.
class InvalidNotebookError extends Error {
    constructor(public readonly invalid: InvalidNotebook) {
        super(`invalid notebook ${invalid.notebookId}: ${invalid.error}`);
        this.name = 'InvalidNotebookError';
    }
}

export interface AppStateRestorationProgress {
    restoreConnections: ProgressCounter;
    restoreCatalogs: ProgressCounter;
    restoreNotebookScripts: ProgressCounter;
    analyzeScripts: ProgressCounter;
}

/// Restores notebook scripts from storage
async function restoreNotebookScripts(
    core: DashQL,
    backend: StorageBackend,
    notebookId: string,
    connectorInfo: ConnectorInfo,
    connectionCatalog: any,
    notebookMetadata: any,
    logger: Logger
): Promise<NotebookScripts> {
    const scripts: Record<number, ScriptData> = {};

    try {
        // Load script folders from storage
        logger.info("Loading script folders", { notebookId }, LOG_CTX);
        const pages: ScriptFolderData[] = await backend.loadScriptFolders(notebookId);
        logger.info("Script folders loaded", {
            notebookId,
            pageCount: pages.length.toString()
        }, LOG_CTX);

        // Reconstruct scripts and pages
        const scriptFolders: { [folderName: string]: { folderName: string; scripts: { [fileName: string]: { scriptId: number; fileName: string } } } } = {};

        logger.info("Reconstructing scripts and pages", {
            notebookId,
            pageCount: pages.length.toString()
        }, LOG_CTX);

        for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
            const page = pages[pageIndex];
            const pageScripts: { [fileName: string]: { scriptId: number; fileName: string } } = {};

            logger.info("Processing page", {
                notebookId,
                pageIndex: `${pageIndex + 1}/${pages.length}`,
                scriptCount: page.scripts.length.toString()
            }, LOG_CTX);

            for (const scriptFile of page.scripts) {
                // Create WASM script
                const script = core.createScript(connectionCatalog);
                const scriptKey = script.getCatalogEntryId();

                // Register ownership before hydrating text so the outer rollback also frees a script
                // whose replaceText call fails.
                scripts[scriptKey] = {
                    scriptKey,
                    script,
                    scriptAnalysis: {
                        buffers: {
                            parsed: null,
                            analyzed: null,
                            destroy: () => { },
                        },
                        outdated: true,
                    },
                    annotations: createEmptyAnnotations(),
                    statistics: Immutable.List(),
                    cursor: null,
                    completion: null,
                    pendingDiff: null,
                    latestQueryId: null,
                    latestAgentRunId: null,
                    fileName: scriptFile.name,
                    folderName: page.name,
                };

                // Set SQL content. The guarded Phase 4 pass analyzes and registers every script.
                script.replaceText(scriptFile.sql);

                // Create page script reference
                pageScripts[scriptFile.name] = {
                    scriptId: scriptKey,
                    fileName: scriptFile.name,
                };
            }

            scriptFolders[page.name] = {
                folderName: page.name,
                scripts: pageScripts,
            };
        }

        // Ensure at least one page exists
        if (Object.keys(scriptFolders).length === 0) {
            logger.info("No pages found, creating empty page", { notebookId }, LOG_CTX);
            scriptFolders['Untitled'] = { folderName: 'Untitled', scripts: {} };
        }

        // Create uncommitted script
        logger.info("Creating uncommitted script", { notebookId }, LOG_CTX);
        const [uncommittedKey, uncommittedData] = createEmptyScriptData(core, connectionCatalog);
        scripts[uncommittedKey] = uncommittedData;

        // Load draft script if exists
        logger.info("Loading draft script", { notebookId }, LOG_CTX);
        const draftSql = await backend.loadScriptDraft(notebookId);
        if (draftSql) {
            logger.info("Draft script loaded", {
                notebookId,
                draftLength: draftSql.length.toString()
            }, LOG_CTX);
            uncommittedData.script.replaceText(draftSql);
            uncommittedData.scriptAnalysis.outdated = true;
        } else {
            logger.info("No draft script found", { notebookId }, LOG_CTX);
        }

        // Pick the first sorted page as the initial focus. Use the same numeric-aware ordering the
        // tab bar renders with, so the focused page matches the first tab even with ordering prefixes.
        const sortedFolders = sortScriptFolderNamesNumerically(Object.keys(scriptFolders));
        const initialFolder = sortedFolders[0] ?? '';
        const initialPage = initialFolder ? scriptFolders[initialFolder] : null;
        const initialFile = initialPage
            ? (Object.keys(initialPage.scripts).sort((a, b) => a.localeCompare(b))[0] ?? '')
            : '';

        const notebookScripts: NotebookScripts = {
            instance: core,
            notebookId,
            notebookMetadata,
            connectorInfo,
            connectionCatalog,
            scripts,
            scriptFolders,
            uncommittedScriptId: uncommittedKey,
            scriptFocus: { folderName: initialFolder, fileName: initialFile, interactionCounter: 0 },
            semanticUserFocus: null,
        };

        return notebookScripts;
    } catch (error) {
        for (const scriptData of Object.values(scripts)) {
            scriptData.scriptAnalysis.buffers.destroy(scriptData.scriptAnalysis.buffers);
            scriptData.script.destroy();
        }
        throw error;
    }
}

/// Restores a single notebook (connection + catalog + notebook)
async function restoreNotebookEntry(
    core: DashQL,
    backend: StorageBackend,
    logger: Logger,
    notebookEntry: NotebookEntry,
    connectionStates: Map<string, ConnectionState>,
    connectionSignatures: Map<string, string | null>,
    connectionStatesByType: string[][],
    notebookScripts: Map<string, NotebookScripts>,
    notebookScriptsByConnection: Map<string, string>,
    notebookScriptsByConnectionType: string[][],
    restoreConnections: ProgressCounter,
    restoreCatalogs: ProgressCounter,
    restoreNotebookScriptsProgress: ProgressCounter,
    analyzeScripts: ProgressCounter,
    progressConsumer: (progress: AppStateRestorationProgress) => void
): Promise<void> {
    // The notebook UUID is the authoritative identity and the key the backend routes on. Gate it up
    // front: a manifest entry whose path is not a valid UUID can't be loaded (the backend would
    // build a bogus path and throw), so surface it as an invalid notebook rather than a hard failure.
    const notebookId = notebookEntry.path;
    if (!isValidUuid(notebookId)) {
        const invalid = describeInvalidNotebook(notebookEntry, NotebookValidationError.InvalidNotebookId, null);
        logger.warn("Refusing to load notebook with an invalid id", {
            notebookId,
            reason: invalid.error,
        }, LOG_CTX);
        throw new InvalidNotebookError(invalid);
    }

    // Phase 1: Restore connection
    logger.info("Restoring connection", { notebookId }, LOG_CTX);
    const connectionStartTime = performance.now();
    restoreConnections.addStarted();
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebookScripts: restoreNotebookScriptsProgress.clone(),
        analyzeScripts: analyzeScripts.clone(),
    });

    logger.info("Loading notebook data", { notebookId }, LOG_CTX);
    // The manifest registers this notebook, but its files may be gone (a native notebook whose folder
    // the user moved/deleted, or a corrupt/absent OPFS notebook). Treat a load failure the same as a
    // metadata rejection: surface it as an invalid notebook so the selector shows it blocked and
    // deletable, rather than letting it fall through to the loader's generic "failed to restore"
    // path — which logs an error on every launch and leaves the stale entry with no way to remove it.
    let notebookData: NotebookData;
    try {
        notebookData = await backend.loadNotebook(notebookId);
    } catch (loadError) {
        const invalid = describeInvalidNotebook(notebookEntry, NotebookValidationError.NotebookUnreadable, null);
        logger.warn("Refusing to load notebook with unreadable files", {
            notebookId,
            reason: invalid.error,
            error: stringifyError(loadError),
        }, LOG_CTX);
        throw new InvalidNotebookError(invalid);
    }

    // Fail-fast metadata validation: refuse to load a notebook whose metadata is structurally
    // unusable (no id, no connection params, or params that map to no known connector). This runs
    // before any heavy restore work and surfaces the notebook as invalid in the selector rather than
    // letting it blow up mid-restore. Runtime hiccups (catalog/notebook) remain non-fatal below.
    const validation = validateNotebookData(notebookData);
    if (!validation.ok) {
        const invalid = describeInvalidNotebook(notebookEntry, validation.error, notebookData);
        logger.warn("Refusing to load invalid notebook", {
            notebookId,
            reason: invalid.error,
        }, LOG_CTX);
        throw new InvalidNotebookError(invalid);
    }

    const { connectionParams } = notebookData;
    logger.info("Notebook data loaded", { notebookId }, LOG_CTX);

    // Decode connection details (validation above guarantees the params map to a known connector)
    const [connectorInfo, details] = decodeConnectionFromProto(
        connectionParams as any,
        notebookId
    );

    // Restore connection state
    logger.info("Restoring connection state", {
        notebookId,
        connectorType: ConnectorType[connectorInfo.connectorType]
    }, LOG_CTX);
    const connectionState = restoreConnectionState(
        core,
        notebookId,
        connectorInfo,
        details,
        connectionSignatures,
        // The optional user-supplied `name` becomes the primary label; blank means unnamed.
        notebookData.name?.trim() || null
    );

    connectionStates.set(notebookId, connectionState);
    connectionStatesByType[connectorInfo.connectorType].push(notebookId);

    const connectionDuration = performance.now() - connectionStartTime;
    logger.info("Connection restored", {
        notebookId,
        connectorType: ConnectorType[connectorInfo.connectorType],
        durationMs: connectionDuration.toFixed(2)
    }, LOG_CTX);

    restoreConnections.addSucceeded();

    // Phase 2: Restore catalog
    logger.info("Restoring catalog", { notebookId }, LOG_CTX);
    const catalogStartTime = performance.now();
    restoreCatalogs.addStarted();
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebookScripts: restoreNotebookScriptsProgress.clone(),
        analyzeScripts: analyzeScripts.clone(),
    });

    try {
        // Load catalog schema SQL from storage
        logger.info("Loading catalog schema", { notebookId }, LOG_CTX);
        const schemaSQL = await backend.loadNotebookSchema(notebookId);
        if (schemaSQL && schemaSQL.trim().length > 0) {
            logger.info("Catalog schema loaded", {
                notebookId,
                schemaLength: schemaSQL.length.toString()
            }, LOG_CTX);

            const { catalog, catalogRelationScript } = connectionState;

            // Apply schema to catalog script
            logger.info("Analyzing catalog schema", { notebookId }, LOG_CTX);
            catalogRelationScript.replaceText(schemaSQL);
            catalogRelationScript.analyze();

            // Load into catalog (drop old first if exists)
            logger.info("Loading catalog schema into catalog", { notebookId }, LOG_CTX);
            try {
                catalog.dropScript(catalogRelationScript);
            } catch (e) {
                // Script not loaded yet, ignore
            }
            catalog.loadScript(catalogRelationScript, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);

            // Mark as restored
            connectionState.catalogUpdates.restoredAt = new Date();

            const catalogDuration = performance.now() - catalogStartTime;
            logger.info("Catalog schema restored", {
                notebookId,
                schemaLength: schemaSQL.length.toString(),
                durationMs: catalogDuration.toFixed(2)
            }, LOG_CTX);
        } else {
            logger.info("No catalog schema found for notebook", { notebookId }, LOG_CTX);
        }

        // Load function catalog SQL from storage
        const functionsSQL = await backend.loadNotebookFunctions(notebookId);
        if (functionsSQL && functionsSQL.trim().length > 0) {
            logger.info("Catalog functions loaded", {
                notebookId,
                functionsLength: functionsSQL.length.toString()
            }, LOG_CTX);

            const { catalog, catalogFunctionScript } = connectionState;

            catalogFunctionScript.replaceText(functionsSQL);
            catalogFunctionScript.analyze();

            try {
                catalog.dropScript(catalogFunctionScript);
            } catch (e) {
                // Script not loaded yet, ignore
            }
            catalog.loadScript(catalogFunctionScript, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);

            logger.info("Catalog functions restored", { notebookId }, LOG_CTX);
        }

        restoreCatalogs.addSucceeded();
    } catch (catalogError) {
        const catalogDuration = performance.now() - catalogStartTime;

        logger.warn("Failed to restore catalog, will refresh on connect", {
            notebookId,
            durationMs: catalogDuration.toFixed(2),
            error: stringifyError(catalogError)
        }, LOG_CTX);

        // Catalog restoration is non-critical - connection is still usable
        restoreCatalogs.addFailed();
    }

    // Phase 3: Restore notebook scripts
    logger.info("Restoring notebook scripts", { notebookId }, LOG_CTX);
    const notebookScriptsStartTime = performance.now();
    restoreNotebookScriptsProgress.addStarted();
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebookScripts: restoreNotebookScriptsProgress.clone(),
        analyzeScripts: analyzeScripts.clone(),
    });

    let restoredNotebookScripts: NotebookScripts | null = null;
    try {
        restoredNotebookScripts = await restoreNotebookScripts(
            core,
            backend,
            notebookId,
            connectorInfo,
            connectionState.catalog,
            notebookData.metadata,
            logger
        );

        const notebookScriptsDuration = performance.now() - notebookScriptsStartTime;
        logger.info("Notebook scripts restored", {
            notebookId,
            pageCount: Object.keys(restoredNotebookScripts.scriptFolders).length.toString(),
            scriptCount: Object.keys(restoredNotebookScripts.scripts).length.toString(),
            durationMs: notebookScriptsDuration.toFixed(2)
        }, LOG_CTX);

        restoreNotebookScriptsProgress.addSucceeded();
    } catch (notebookScriptsError) {
        const notebookScriptsDuration = performance.now() - notebookScriptsStartTime;

        logger.warn("Failed to restore notebook scripts", {
            notebookId,
            durationMs: notebookScriptsDuration.toFixed(2),
            error: stringifyError(notebookScriptsError),
            stack: (notebookScriptsError instanceof Error ? notebookScriptsError.stack : (notebookScriptsError as any)?.stack)?.substring(0, 500)
        }, LOG_CTX);

        restoreNotebookScriptsProgress.addFailed();
    }

    // Phase 4: Analyze the restored notebook scripts eagerly.
    //
    // The catalog was populated in Phase 2, so analyzing here gives every script
    // at least one analyzed copy (and derived annotations, incl. the resolved
    // VISUALIZE query) before the user can interact with it. Without this, the
    // first execution of a freshly restored VISUALIZE script would send the raw
    // `visualize (...)` text to the backend.
    if (restoredNotebookScripts != null) {
        const analyzeStartTime = performance.now();
        // Account per script: analyzeAllScripts reports the notebook's
        // script count up front and the outcome of each script as it finishes.
        // The work is synchronous, so we only need the totals to be correct once
        // it returns — the progressConsumer below reports the accumulated state.
        let scriptCount = 0;
        let scriptsReported = 0;
        const analyzeProgress: AnalyzeAllScriptsProgress = {
            onScriptCount: (count) => {
                scriptCount = count;
                analyzeScripts.addTotal(count).addStarted(count);
            },
            onScriptDone: (ok) => {
                scriptsReported++;
                if (ok) {
                    analyzeScripts.addSucceeded();
                } else {
                    analyzeScripts.addFailed();
                }
            },
        };
        try {
            restoredNotebookScripts = analyzeAllScripts(restoredNotebookScripts, logger, analyzeProgress);
            logger.info("Notebook scripts analyzed", {
                notebookId,
                scriptCount: scriptCount.toString(),
                durationMs: (performance.now() - analyzeStartTime).toFixed(2)
            }, LOG_CTX);
        } catch (analyzeError) {
            // Per-script failures are isolated inside analyzeAllScripts,
            // so reaching here is an unexpected wholesale failure. Lazy analysis
            // (editor/execute) still covers these scripts, so it must not abort the
            // notebook restore. Reconcile any scripts that never reported so the
            // counter can still complete.
            logger.warn("Failed to analyze notebook scripts, will analyze lazily", {
                notebookId,
                durationMs: (performance.now() - analyzeStartTime).toFixed(2),
                error: stringifyError(analyzeError)
            }, LOG_CTX);
            for (let i: number = scriptsReported; i < scriptCount; ++i) {
                analyzeScripts.addFailed();
            }
        }

        notebookScripts.set(notebookId, restoredNotebookScripts);
        notebookScriptsByConnection.set(notebookId, notebookId);
        notebookScriptsByConnectionType[connectorInfo.connectorType].push(notebookId);
    }
    // A notebook that failed to restore contributes no scripts to analyze, so the
    // analyze counter is left untouched in that case.

    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebookScripts: restoreNotebookScriptsProgress.clone(),
        analyzeScripts: analyzeScripts.clone(),
    });
}

/// The connection + notebook a single notebook restored into.
export interface RestoredNotebook {
    notebookId: string;
    connectorType: ConnectorType;
    connection: ConnectionState;
    notebookScripts: NotebookScripts;
}

export function destroyRestoredNotebook(restored: RestoredNotebook): void {
    destroyNotebookScripts(restored.notebookScripts);
    destroyRestoredConnection(restored.connection);
}

function destroyRestoredConnection(connection: ConnectionState): void {
    connection.connectionSignature.signatures.delete(
        connection.connectionSignature.signatureString,
    );
    connection.catalogRelationScript.destroy();
    connection.catalogFunctionScript.destroy();
    connection.catalog.destroy();
}

/// Restore a single, already-persisted notebook (connection + catalog + notebook) into fresh scratch
/// maps and return just that notebook's pieces.
///
/// This is the incremental counterpart to `restoreAppState`, used after a notebook is written to
/// storage at runtime (e.g. imported from a shared URL) so it can be merged into the already-live
/// registries without a full app reload. It reuses the exact same `restoreNotebookEntry` path the boot
/// loader runs, so a URL-imported notebook is decoded, cataloged and analyzed identically to one
/// loaded at startup.
export async function restoreSingleNotebook(
    core: DashQL,
    backend: StorageBackend,
    logger: Logger,
    notebookId: string,
    connectionSignatures: Map<string, string | null>,
): Promise<RestoredNotebook> {
    // A freshly imported notebook is implicitly OPFS-backed and keyed by its UUID; that's all the
    // manifest entry `restoreNotebookEntry` needs to route the load.
    const notebookEntry: NotebookEntry = { path: notebookId, storageType: StorageBackendType.OPFS };

    const connectionStates = new Map<string, ConnectionState>();
    const notebookScripts = new Map<string, NotebookScripts>();
    const notebookScriptsByConnection = new Map<string, string>();
    const connectionStatesByType: string[][] = [[], [], [], []];
    const notebookScriptsByConnectionType: string[][] = [[], [], [], []];

    const noopConsumer = () => { };
    await restoreNotebookEntry(
        core,
        backend,
        logger,
        notebookEntry,
        connectionStates,
        connectionSignatures,
        connectionStatesByType,
        notebookScripts,
        notebookScriptsByConnection,
        notebookScriptsByConnectionType,
        new ProgressCounter(),
        new ProgressCounter(),
        new ProgressCounter(),
        new ProgressCounter(),
        noopConsumer,
    );

    const connection = connectionStates.get(notebookId);
    if (!connection) {
        // restoreNotebookEntry only fails to register a connection by throwing (invalid/unreadable), which
        // would have propagated above. Reaching here means the persisted id didn't match — treat it
        // as a hard restore failure rather than silently returning a half-loaded notebook.
        throw new Error(`imported notebook ${notebookId} did not restore a connection`);
    }
    const scripts = notebookScripts.get(notebookId) ?? null;
    if (!scripts) {
        destroyRestoredConnection(connection);
        throw new Error(`imported notebook ${notebookId} did not restore its scripts`);
    }
    return {
        notebookId,
        connectorType: connection.connectorInfo.connectorType,
        connection,
        notebookScripts: scripts,
    };
}

/**
 * Restores complete application state from storage
 */
export async function restoreAppState(
    core: DashQL,
    backend: StorageBackend,
    logger: Logger,
    progressConsumer: (progress: AppStateRestorationProgress) => void
): Promise<RestoredAppState> {
    logger.info("Starting app state restoration", {}, LOG_CTX);
    const startTime = performance.now();

    const connectionStates = new Map<string, ConnectionState>();
    const connectionSignatures = new Map<string, string | null>();
    const notebookScripts = new Map<string, NotebookScripts>();
    const notebookScriptsByConnection = new Map<string, string>();
    const invalidNotebooks = new Map<string, InvalidNotebook>();

    // Initialize indices (sized for all ConnectorType values: 0-3)
    const connectionStatesByType: string[][] = [[], [], [], []];
    const notebookScriptsByConnectionType: string[][] = [[], [], [], []];

    // Initialize progress counters
    const restoreConnections = new ProgressCounter();
    const restoreCatalogs = new ProgressCounter();
    const restoreNotebookScriptsProgress = new ProgressCounter();
    const analyzeScripts = new ProgressCounter();

    try {
        // Load manifest
        logger.info("Loading app manifest", {}, LOG_CTX);
        const manifestStartTime = performance.now();
        const notebookEntries = await backend.listNotebooks('dashql-manifest.json');
        const manifestDuration = performance.now() - manifestStartTime;

        logger.info("Loaded app manifest", {
            notebookCount: notebookEntries.length.toString(),
            durationMs: manifestDuration.toFixed(2)
        }, LOG_CTX);

        // Set totals.
        //
        // analyzeScripts is counted per script, not per notebook, so its total
        // is accumulated as each notebook reports its script count in Phase 4
        // (see onScriptCount) rather than seeded here.
        restoreConnections.addTotal(notebookEntries.length);
        restoreCatalogs.addTotal(notebookEntries.length);
        restoreNotebookScriptsProgress.addTotal(notebookEntries.length);

        progressConsumer({
            restoreConnections: restoreConnections.clone(),
            restoreCatalogs: restoreCatalogs.clone(),
            restoreNotebookScripts: restoreNotebookScriptsProgress.clone(),
            analyzeScripts: analyzeScripts.clone(),
        });

        // Process each notebook
        logger.info("Restoring notebooks", { count: notebookEntries.length.toString() }, LOG_CTX);
        for (let i = 0; i < notebookEntries.length; i++) {
            const notebookEntry = notebookEntries[i];
            const notebookStartTime = performance.now();

            try {
                logger.info("Restoring notebook", {
                    index: `${i + 1}/${notebookEntries.length}`,
                    notebookId: notebookEntry.path
                }, LOG_CTX);

                await restoreNotebookEntry(
                    core,
                    backend,
                    logger,
                    notebookEntry,
                    connectionStates,
                    connectionSignatures,
                    connectionStatesByType,
                    notebookScripts,
                    notebookScriptsByConnection,
                    notebookScriptsByConnectionType,
                    restoreConnections,
                    restoreCatalogs,
                    restoreNotebookScriptsProgress,
                    analyzeScripts,
                    progressConsumer
                );

                const notebookDuration = performance.now() - notebookStartTime;
                logger.info("Notebook restored", {
                    index: `${i + 1}/${notebookEntries.length}`,
                    notebookId: notebookEntry.path,
                    durationMs: notebookDuration.toFixed(2)
                }, LOG_CTX);
            } catch (error) {
                const notebookDuration = performance.now() - notebookStartTime;

                if (error instanceof InvalidNotebookError) {
                    // Metadata validation refused this notebook up front. Record it so the selector
                    // can show it as invalid (blocked, deletable), and account it as *skipped*
                    // rather than *failed* — nothing was attempted, the metadata was simply
                    // unusable. The notebook contributed no connection/catalog/scripts/scripts.
                    invalidNotebooks.set(error.invalid.notebookId, error.invalid);
                    restoreConnections.addSkipped();
                    restoreCatalogs.addSkipped();
                    restoreNotebookScriptsProgress.addSkipped();

                    progressConsumer({
                        restoreConnections: restoreConnections.clone(),
                        restoreCatalogs: restoreCatalogs.clone(),
                        restoreNotebookScripts: restoreNotebookScriptsProgress.clone(),
                        analyzeScripts: analyzeScripts.clone(),
                    });
                    continue;
                }

                logger.warn("Failed to restore notebook", {
                    index: `${i + 1}/${notebookEntries.length}`,
                    notebookId: notebookEntry.path,
                    durationMs: notebookDuration.toFixed(2),
                    error: stringifyError(error)
                }, LOG_CTX);

                restoreConnections.addFailed();
                restoreCatalogs.addFailed();
                restoreNotebookScriptsProgress.addFailed();
                // analyzeScripts is counted per script: a notebook that fails
                // here failed before Phase 4 ran, so it contributed no scripts and
                // must not register a failure against the per-script counter.

                progressConsumer({
                    restoreConnections: restoreConnections.clone(),
                    restoreCatalogs: restoreCatalogs.clone(),
                    restoreNotebookScripts: restoreNotebookScriptsProgress.clone(),
                    analyzeScripts: analyzeScripts.clone(),
                });
            }
        }
    } catch (manifestError) {
        logger.warn("Failed to load manifest, starting with empty state", {
            error: stringifyError(manifestError)
        }, LOG_CTX);
    }

    // The analyze counter's total is accumulated per script during Phase 4. If no
    // notebook reached Phase 4 (empty manifest, or every notebook failed earlier),
    // it was never seeded — pin it to 0 so the indicator resolves to "nothing to
    // do" instead of an indefinite blank state.
    if (analyzeScripts.total == null) {
        analyzeScripts.addTotal(0);
    }
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebookScripts: restoreNotebookScriptsProgress.clone(),
        analyzeScripts: analyzeScripts.clone(),
    });

    const totalDuration = performance.now() - startTime;
    logger.info("Finished loading app state", {
        connections: connectionStates.size.toString(),
        notebookScripts: notebookScripts.size.toString(),
        invalidNotebooks: invalidNotebooks.size.toString(),
        connectionsSucceeded: restoreConnections.succeeded.toString(),
        connectionsFailed: restoreConnections.failed.toString(),
        connectionsSkipped: restoreConnections.skipped.toString(),
        totalDurationMs: totalDuration.toFixed(2)
    }, LOG_CTX);

    return {
        connectionStates,
        connectionStatesByType,
        connectionSignatures,
        notebookScripts,
        notebookScriptsByConnection,
        notebookScriptsByConnectionType,
        invalidNotebooks,
    };
}
