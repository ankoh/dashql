import type { DashQL } from '../../core/api.js';
import type { Logger } from '../logger/logger.js';
import { ProgressCounter } from '../../utils/progress.js';
import type { ConnectionState } from '../../connection/connection_state.js';
import type { NotebookState, ScriptData as NotebookScriptData } from '../../notebook/notebook_state.js';
import { createEmptyScriptData } from '../../notebook/notebook_state.js';
import { decodeConnectionFromProto, restoreConnectionState } from '../../connection/connection_import.js';
import { ConnectorType, type ConnectorInfo } from '../../connection/connector_info.js';
import type { StorageBackend, SessionEntry, SessionData, PageData } from './storage_backend.js';
import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from '../../connection/catalog_update_state.js';
import { createEmptyAnnotations } from '../../notebook/notebook_types.js';
import * as Immutable from 'immutable';

const LOG_CTX = "app_state_restorer";

export interface RestoredAppState {
    connectionStates: Map<string, ConnectionState>;
    connectionStatesByType: string[][];
    connectionSignatures: Map<string, string | null>;
    notebooks: Map<string, NotebookState>;
    notebooksByConnection: Map<string, string>;
    notebooksByConnectionType: string[][];
}

export interface AppStateRestorationProgress {
    restoreConnections: ProgressCounter;
    restoreCatalogs: ProgressCounter;
    restoreNotebooks: ProgressCounter;
}

/// Restores notebook state from storage
async function restoreNotebook(
    core: DashQL,
    backend: StorageBackend,
    sessionId: string,
    sessionPath: string,
    connectorInfo: ConnectorInfo,
    connectionCatalog: any,
    notebookMetadata: any
): Promise<NotebookState> {
    const scriptRegistry = core.createScriptRegistry();

    // Load notebook pages from storage
    const pages: PageData[] = await backend.loadNotebookPages(sessionPath);

    // Reconstruct scripts and pages
    const scripts: Record<number, NotebookScriptData> = {};
    const notebookPages: any[] = [];

    for (const page of pages) {
        const pageScripts: any[] = [];

        for (const scriptFile of page.scripts) {
            // Create WASM script
            const script = core.createScript(connectionCatalog);
            const scriptKey = script.getCatalogEntryId();

            // Set SQL content
            script.replaceText(scriptFile.sql);

            // Create script data
            scripts[scriptKey] = {
                scriptKey,
                script,
                scriptAnalysis: {
                    buffers: {
                        scanned: null,
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
                latestQueryId: null,
            };

            // Add to registry
            scriptRegistry.addScript(script);

            // Create page script reference
            pageScripts.push({
                scriptId: scriptKey,
                title: "",
            });
        }

        notebookPages.push({ scripts: pageScripts });
    }

    // Ensure at least one page exists
    if (notebookPages.length === 0) {
        notebookPages.push({ scripts: [] });
    }

    // Create uncommitted script
    const [uncommittedKey, uncommittedData] = createEmptyScriptData(core, connectionCatalog);
    scripts[uncommittedKey] = uncommittedData;

    // Load draft script if exists
    const draftSql = await backend.loadNotebookScriptDraft(sessionPath);
    if (draftSql) {
        uncommittedData.script.replaceText(draftSql);
        uncommittedData.scriptAnalysis.outdated = true;
    }

    const notebookState: NotebookState = {
        instance: core,
        sessionId,
        sessionPath,
        notebookMetadata,
        connectorInfo,
        connectionCatalog,
        scriptRegistry,
        scripts,
        notebookPages,
        uncommittedScriptId: uncommittedKey,
        notebookUserFocus: { pageIndex: 0, entryInPage: 0 },
        semanticUserFocus: null,
    };

    return notebookState;
}

/// Restores a single session (connection + catalog + notebook)
async function restoreSession(
    core: DashQL,
    backend: StorageBackend,
    logger: Logger,
    sessionEntry: SessionEntry,
    connectionStates: Map<string, ConnectionState>,
    connectionSignatures: Map<string, string | null>,
    connectionStatesByType: string[][],
    notebooks: Map<string, NotebookState>,
    notebooksByConnection: Map<string, string>,
    notebooksByConnectionType: string[][],
    restoreConnections: ProgressCounter,
    restoreCatalogs: ProgressCounter,
    restoreNotebooks: ProgressCounter,
    progressConsumer: (progress: AppStateRestorationProgress) => void
): Promise<void> {
    const sessionPath = sessionEntry.path;

    // Phase 1: Restore connection
    restoreConnections.addStarted();
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebooks: restoreNotebooks.clone(),
    });

    const sessionData: SessionData = await backend.loadSession(sessionPath);
    const { sessionId, connectionParams } = sessionData;

    // Validate connectionParams exists
    if (!connectionParams) {
        throw new Error(`Session ${sessionId} has no connectionParams`);
    }

    // Decode connection details
    const [connectorInfo, details] = decodeConnectionFromProto(
        connectionParams as any,
        sessionId
    );

    // Skip connections without setupParams (not yet configured)
    // These are connections that were allocated but never completed setup
    if (connectorInfo.connectorType !== ConnectorType.DATALESS &&
        connectorInfo.connectorType !== ConnectorType.DEMO) {
        // Check if this connection has setupParams
        if ('proto' in details.value && !details.value.proto.setupParams) {
            logger.warn("skipping unconfigured session (no setupParams)", {
                sessionId,
                sessionPath,
                connectorType: ConnectorType[connectorInfo.connectorType]
            }, LOG_CTX);

            restoreConnections.addSkipped();
            restoreCatalogs.addSkipped();
            restoreNotebooks.addSkipped();

            progressConsumer({
                restoreConnections: restoreConnections.clone(),
                restoreCatalogs: restoreCatalogs.clone(),
                restoreNotebooks: restoreNotebooks.clone(),
            });
            return;
        }
    }

    // Skip DEMO and DATALESS sessions (ephemeral, not restored)
    if (connectorInfo.connectorType === ConnectorType.DEMO ||
        connectorInfo.connectorType === ConnectorType.DATALESS) {
        logger.debug("skipping ephemeral session", {
            sessionId,
            type: ConnectorType[connectorInfo.connectorType]
        }, LOG_CTX);

        restoreConnections.addSkipped();
        restoreCatalogs.addSkipped();
        restoreNotebooks.addSkipped();

        progressConsumer({
            restoreConnections: restoreConnections.clone(),
            restoreCatalogs: restoreCatalogs.clone(),
            restoreNotebooks: restoreNotebooks.clone(),
        });
        return;
    }

    // Restore connection state
    const connectionState = restoreConnectionState(
        core,
        sessionId,
        sessionPath,
        connectorInfo,
        details,
        connectionSignatures
    );

    connectionStates.set(sessionId, connectionState);
    connectionStatesByType[connectorInfo.connectorType].push(sessionId);

    restoreConnections.addSucceeded();

    // Phase 2: Restore catalog
    restoreCatalogs.addStarted();
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebooks: restoreNotebooks.clone(),
    });

    try {
        // Load catalog schema SQL from storage
        const schemaSQL = await backend.loadSessionSchema(sessionPath);
        if (schemaSQL && schemaSQL.trim().length > 0) {
            const { catalog, catalogScript } = connectionState;

            // Apply schema to catalog script
            catalogScript.replaceText(schemaSQL);
            catalogScript.analyze();

            // Load into catalog (drop old first if exists)
            try {
                catalog.dropScript(catalogScript);
            } catch (e) {
                // Script not loaded yet, ignore
            }
            catalog.loadScript(catalogScript, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);

            // Mark as restored
            connectionState.catalogUpdates.restoredAt = new Date();

            logger.debug("restored catalog schema", {
                sessionId,
                schemaLength: schemaSQL.length.toString()
            }, LOG_CTX);
        } else {
            logger.debug("no catalog schema found for session", { sessionId }, LOG_CTX);
        }

        restoreCatalogs.addSucceeded();
    } catch (catalogError) {
        logger.warn("failed to restore catalog, will refresh on connect", {
            sessionId,
            error: catalogError instanceof Error ? catalogError.message : String(catalogError)
        }, LOG_CTX);

        // Catalog restoration is non-critical - connection is still usable
        restoreCatalogs.addFailed();
    }

    // Phase 3: Restore notebook
    restoreNotebooks.addStarted();
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebooks: restoreNotebooks.clone(),
    });

    try {
        const notebookState = await restoreNotebook(
            core,
            backend,
            sessionId,
            sessionPath,
            connectorInfo,
            connectionState.catalog,
            sessionData.notebook
        );

        notebooks.set(sessionId, notebookState);
        notebooksByConnection.set(sessionId, sessionId);
        notebooksByConnectionType[connectorInfo.connectorType].push(sessionId);

        restoreNotebooks.addSucceeded();
    } catch (notebookError) {
        logger.error("failed to restore notebook", {
            sessionId,
            error: notebookError instanceof Error ? notebookError.message : String(notebookError)
        }, LOG_CTX);

        restoreNotebooks.addFailed();
    }

    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebooks: restoreNotebooks.clone(),
    });
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
    const connectionStates = new Map<string, ConnectionState>();
    const connectionSignatures = new Map<string, string | null>();
    const notebooks = new Map<string, NotebookState>();
    const notebooksByConnection = new Map<string, string>();

    // Initialize indices (sized for all ConnectorType values: 0-4)
    const connectionStatesByType: string[][] = [[], [], [], [], []];
    const notebooksByConnectionType: string[][] = [[], [], [], [], []];

    // Initialize progress counters
    const restoreConnections = new ProgressCounter();
    const restoreCatalogs = new ProgressCounter();
    const restoreNotebooks = new ProgressCounter();

    try {
        // Load manifest
        const sessions = await backend.listSessions('dashql-manifest.json');

        // Set totals
        restoreConnections.addTotal(sessions.length);
        restoreCatalogs.addTotal(sessions.length);
        restoreNotebooks.addTotal(sessions.length);

        progressConsumer({
            restoreConnections: restoreConnections.clone(),
            restoreCatalogs: restoreCatalogs.clone(),
            restoreNotebooks: restoreNotebooks.clone(),
        });

        // Process each session
        for (const sessionEntry of sessions) {
            try {
                await restoreSession(
                    core,
                    backend,
                    logger,
                    sessionEntry,
                    connectionStates,
                    connectionSignatures,
                    connectionStatesByType,
                    notebooks,
                    notebooksByConnection,
                    notebooksByConnectionType,
                    restoreConnections,
                    restoreCatalogs,
                    restoreNotebooks,
                    progressConsumer
                );
            } catch (error) {
                logger.error("failed to restore session", {
                    sessionPath: sessionEntry.path,
                    error: error instanceof Error ? error.message : String(error)
                }, LOG_CTX);

                restoreConnections.addFailed();
                restoreCatalogs.addFailed();
                restoreNotebooks.addFailed();

                progressConsumer({
                    restoreConnections: restoreConnections.clone(),
                    restoreCatalogs: restoreCatalogs.clone(),
                    restoreNotebooks: restoreNotebooks.clone(),
                });
            }
        }
    } catch (manifestError) {
        logger.warn("failed to load manifest, starting with empty state", {
            error: manifestError instanceof Error ? manifestError.message : String(manifestError)
        }, LOG_CTX);
    }

    logger.info("app state restoration complete", {
        connections: connectionStates.size.toString(),
        notebooks: notebooks.size.toString(),
        connectionsSucceeded: restoreConnections.succeeded.toString(),
        connectionsFailed: restoreConnections.failed.toString(),
        connectionsSkipped: restoreConnections.skipped.toString(),
    }, LOG_CTX);

    return {
        connectionStates,
        connectionStatesByType,
        connectionSignatures,
        notebooks,
        notebooksByConnection,
        notebooksByConnectionType,
    };
}
