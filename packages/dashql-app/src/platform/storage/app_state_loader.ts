import type { DashQL } from '../../core/api.js';
import type { Logger } from '../logger/logger.js';
import { stringifyError } from '../logger/logger.js';
import { ProgressCounter } from '../../utils/progress.js';
import type { ConnectionState } from '../../connection/connection_state.js';
import type { NotebookState, ScriptData as NotebookScriptData } from '../../notebook/notebook_state.js';
import { analyzeAllScriptsInNotebook, createEmptyScriptData, sortFolderNamesNumerically } from '../../notebook/notebook_state.js';
import type { AnalyzeAllScriptsProgress } from '../../notebook/notebook_state.js';
import { decodeConnectionFromProto, restoreConnectionState } from '../../connection/connection_import.js';
import { ConnectorType, type ConnectorInfo } from '../../connection/connector_info.js';
import type { StorageBackend, SessionEntry, SessionData, PageData } from './storage_backend.js';
import { validateSessionData, describeInvalidSession, isValidUuid, SessionValidationError, type InvalidSession } from './session_validation.js';
import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from '../../connection/catalog_update_state.js';
import { createEmptyAnnotations } from '../../notebook/notebook_types.js';
import * as Immutable from 'immutable';

const LOG_CTX = "app_state_loader";

export interface RestoredAppState {
    connectionStates: Map<string, ConnectionState>;
    connectionStatesByType: string[][];
    connectionSignatures: Map<string, string | null>;
    notebooks: Map<string, NotebookState>;
    notebooksByConnection: Map<string, string>;
    notebooksByConnectionType: string[][];
    /// Sessions whose metadata failed validation and were refused a load (keyed by bare UUID).
    /// These never enter the connection/notebook maps; the session selector surfaces them as
    /// invalid (blocked from opening, still deletable).
    invalidSessions: Map<string, InvalidSession>;
}

/// Thrown by `restoreSession` when a session's metadata fails the up-front validation gate.
///
/// Distinguished from an arbitrary restore error so the loader can record it as a (skipped)
/// invalid session and surface it in the UI, rather than counting it as a hard failure.
class InvalidSessionError extends Error {
    constructor(public readonly invalid: InvalidSession) {
        super(`invalid session ${invalid.sessionId}: ${invalid.error}`);
        this.name = 'InvalidSessionError';
    }
}

export interface AppStateRestorationProgress {
    restoreConnections: ProgressCounter;
    restoreCatalogs: ProgressCounter;
    restoreNotebooks: ProgressCounter;
    analyzeNotebooks: ProgressCounter;
}

/// Restores notebook state from storage
async function restoreNotebook(
    core: DashQL,
    backend: StorageBackend,
    sessionPath: string,
    sessionId: string,
    connectorInfo: ConnectorInfo,
    connectionCatalog: any,
    notebookMetadata: any,
    logger: Logger
): Promise<NotebookState> {
    logger.info("Creating script registry", { sessionId }, LOG_CTX);
    const scriptRegistry = core.createScriptRegistry();

    // Load notebook pages from storage
    logger.info("Loading notebook pages", { sessionId }, LOG_CTX);
    const pages: PageData[] = await backend.loadNotebookPages(sessionPath);
    logger.info("Notebook pages loaded", {
        sessionId,
        pageCount: pages.length.toString()
    }, LOG_CTX);

    // Reconstruct scripts and pages
    const scripts: Record<number, NotebookScriptData> = {};
    const notebookPages: { [folderName: string]: { folderName: string; scripts: { [fileName: string]: { scriptId: number; fileName: string } } } } = {};

    logger.info("Reconstructing scripts and pages", {
        sessionId,
        pageCount: pages.length.toString()
    }, LOG_CTX);

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const pageScripts: { [fileName: string]: { scriptId: number; fileName: string } } = {};

        logger.info("Processing page", {
            sessionId,
            pageIndex: `${pageIndex + 1}/${pages.length}`,
            scriptCount: page.scripts.length.toString()
        }, LOG_CTX);

        for (const scriptFile of page.scripts) {
            // Create WASM script
            const script = core.createScript(connectionCatalog);
            const scriptKey = script.getCatalogEntryId();

            // Set SQL content and analyze
            script.replaceText(scriptFile.sql);
            script.analyze();

            // Create script data
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
                latestQueryId: null,
                latestAgentRunId: null,
                fileName: scriptFile.name,
                folderName: page.name,
            };

            // Add to registry
            scriptRegistry.addScript(script);

            // Create page script reference
            pageScripts[scriptFile.name] = {
                scriptId: scriptKey,
                fileName: scriptFile.name,
            };
        }

        notebookPages[page.name] = {
            folderName: page.name,
            scripts: pageScripts,
        };
    }

    // Ensure at least one page exists
    if (Object.keys(notebookPages).length === 0) {
        logger.info("No pages found, creating empty page", { sessionId }, LOG_CTX);
        notebookPages['Untitled'] = { folderName: 'Untitled', scripts: {} };
    }

    // Create uncommitted script
    logger.info("Creating uncommitted script", { sessionId }, LOG_CTX);
    const [uncommittedKey, uncommittedData] = createEmptyScriptData(core, connectionCatalog);
    scripts[uncommittedKey] = uncommittedData;

    // Load draft script if exists
    logger.info("Loading draft script", { sessionId }, LOG_CTX);
    const draftSql = await backend.loadNotebookScriptDraft(sessionPath);
    if (draftSql) {
        logger.info("Draft script loaded", {
            sessionId,
            draftLength: draftSql.length.toString()
        }, LOG_CTX);
        uncommittedData.script.replaceText(draftSql);
        uncommittedData.scriptAnalysis.outdated = true;
    } else {
        logger.info("No draft script found", { sessionId }, LOG_CTX);
    }

    // Pick the first sorted page as the initial focus. Use the same numeric-aware ordering the
    // tab bar renders with, so the focused page matches the first tab even with ordering prefixes.
    const sortedFolders = sortFolderNamesNumerically(Object.keys(notebookPages));
    const initialFolder = sortedFolders[0] ?? '';
    const initialPage = initialFolder ? notebookPages[initialFolder] : null;
    const initialFile = initialPage
        ? (Object.keys(initialPage.scripts).sort((a, b) => a.localeCompare(b))[0] ?? '')
        : '';

    const notebookState: NotebookState = {
        instance: core,
        sessionId,
        notebookMetadata,
        connectorInfo,
        connectionCatalog,
        scriptRegistry,
        scripts,
        notebookPages,
        uncommittedScriptId: uncommittedKey,
        notebookUserFocus: { folderName: initialFolder, fileName: initialFile, interactionCounter: 0 },
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
    analyzeNotebooks: ProgressCounter,
    progressConsumer: (progress: AppStateRestorationProgress) => void
): Promise<void> {
    // The session UUID is the authoritative identity and the key the backend routes on. Gate it up
    // front: a manifest entry whose path is not a valid UUID can't be loaded (the backend would
    // build a bogus path and throw), so surface it as an invalid session rather than a hard failure.
    const sessionPath = sessionEntry.path;
    if (!isValidUuid(sessionPath)) {
        const invalid = describeInvalidSession(sessionEntry, SessionValidationError.InvalidSessionId, null);
        logger.warn("Refusing to load session with an invalid id", {
            sessionPath,
            reason: invalid.error,
        }, LOG_CTX);
        throw new InvalidSessionError(invalid);
    }

    // Phase 1: Restore connection
    logger.info("Restoring connection", { sessionPath }, LOG_CTX);
    const connectionStartTime = performance.now();
    restoreConnections.addStarted();
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebooks: restoreNotebooks.clone(),
        analyzeNotebooks: analyzeNotebooks.clone(),
    });

    logger.info("Loading session data", { sessionPath }, LOG_CTX);
    const sessionData: SessionData = await backend.loadSession(sessionPath);

    // Fail-fast metadata validation: refuse to load a session whose metadata is structurally
    // unusable (no id, no connection params, or params that map to no known connector). This runs
    // before any heavy restore work and surfaces the session as invalid in the selector rather than
    // letting it blow up mid-restore. Runtime hiccups (catalog/notebook) remain non-fatal below.
    const validation = validateSessionData(sessionData);
    if (!validation.ok) {
        const invalid = describeInvalidSession(sessionEntry, validation.error, sessionData);
        logger.warn("Refusing to load invalid session", {
            sessionPath,
            sessionId: invalid.sessionId,
            reason: invalid.error,
        }, LOG_CTX);
        throw new InvalidSessionError(invalid);
    }

    const { connectionParams } = sessionData;
    // Validation above guarantees a syntactically valid UUID, so the persisted id is the
    // authoritative identity for the in-memory maps, router, and backend routing as-is.
    const sessionId = sessionData.sessionId;
    logger.info("Session data loaded", { sessionId }, LOG_CTX);

    // Decode connection details (validation above guarantees the params map to a known connector)
    const [connectorInfo, details] = decodeConnectionFromProto(
        connectionParams as any,
        sessionId
    );

    // Restore connection state
    logger.info("Restoring connection state", {
        sessionId,
        connectorType: ConnectorType[connectorInfo.connectorType]
    }, LOG_CTX);
    const connectionState = restoreConnectionState(
        core,
        sessionId,
        connectorInfo,
        details,
        connectionSignatures
    );

    connectionStates.set(sessionId, connectionState);
    connectionStatesByType[connectorInfo.connectorType].push(sessionId);

    const connectionDuration = performance.now() - connectionStartTime;
    logger.info("Connection restored", {
        sessionId,
        connectorType: ConnectorType[connectorInfo.connectorType],
        durationMs: connectionDuration.toFixed(2)
    }, LOG_CTX);

    restoreConnections.addSucceeded();

    // Phase 2: Restore catalog
    logger.info("Restoring catalog", { sessionId }, LOG_CTX);
    const catalogStartTime = performance.now();
    restoreCatalogs.addStarted();
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebooks: restoreNotebooks.clone(),
        analyzeNotebooks: analyzeNotebooks.clone(),
    });

    try {
        // Load catalog schema SQL from storage
        logger.info("Loading catalog schema", { sessionId }, LOG_CTX);
        const schemaSQL = await backend.loadSessionSchema(sessionPath);
        if (schemaSQL && schemaSQL.trim().length > 0) {
            logger.info("Catalog schema loaded", {
                sessionId,
                schemaLength: schemaSQL.length.toString()
            }, LOG_CTX);

            const { catalog, catalogRelationScript } = connectionState;

            // Apply schema to catalog script
            logger.info("Analyzing catalog schema", { sessionId }, LOG_CTX);
            catalogRelationScript.replaceText(schemaSQL);
            catalogRelationScript.analyze();

            // Load into catalog (drop old first if exists)
            logger.info("Loading catalog schema into catalog", { sessionId }, LOG_CTX);
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
                sessionId,
                schemaLength: schemaSQL.length.toString(),
                durationMs: catalogDuration.toFixed(2)
            }, LOG_CTX);
        } else {
            logger.info("No catalog schema found for session", { sessionId }, LOG_CTX);
        }

        // Load function catalog SQL from storage
        const functionsSQL = await backend.loadSessionFunctions(sessionPath);
        if (functionsSQL && functionsSQL.trim().length > 0) {
            logger.info("Catalog functions loaded", {
                sessionId,
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

            logger.info("Catalog functions restored", { sessionId }, LOG_CTX);
        }

        restoreCatalogs.addSucceeded();
    } catch (catalogError) {
        const catalogDuration = performance.now() - catalogStartTime;

        logger.warn("Failed to restore catalog, will refresh on connect", {
            sessionId,
            durationMs: catalogDuration.toFixed(2),
            error: stringifyError(catalogError)
        }, LOG_CTX);

        // Catalog restoration is non-critical - connection is still usable
        restoreCatalogs.addFailed();
    }

    // Phase 3: Restore notebook
    logger.info("Restoring notebook", { sessionId }, LOG_CTX);
    const notebookStartTime = performance.now();
    restoreNotebooks.addStarted();
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebooks: restoreNotebooks.clone(),
        analyzeNotebooks: analyzeNotebooks.clone(),
    });

    let restoredNotebook: NotebookState | null = null;
    try {
        restoredNotebook = await restoreNotebook(
            core,
            backend,
            sessionPath,
            sessionId,
            connectorInfo,
            connectionState.catalog,
            sessionData.notebook,
            logger
        );

        const notebookDuration = performance.now() - notebookStartTime;
        logger.info("Notebook restored", {
            sessionId,
            pageCount: Object.keys(restoredNotebook.notebookPages).length.toString(),
            scriptCount: Object.keys(restoredNotebook.scripts).length.toString(),
            durationMs: notebookDuration.toFixed(2)
        }, LOG_CTX);

        restoreNotebooks.addSucceeded();
    } catch (notebookError) {
        const notebookDuration = performance.now() - notebookStartTime;

        logger.error("Failed to restore notebook", {
            sessionId,
            durationMs: notebookDuration.toFixed(2),
            error: stringifyError(notebookError),
            stack: (notebookError instanceof Error ? notebookError.stack : (notebookError as any)?.stack)?.substring(0, 500)
        }, LOG_CTX);

        restoreNotebooks.addFailed();
    }

    // Phase 4: Analyze the restored notebook scripts eagerly.
    //
    // The catalog was populated in Phase 2, so analyzing here gives every script
    // at least one analyzed copy (and derived annotations, incl. the resolved
    // VISUALIZE query) before the user can interact with it. Without this, the
    // first execution of a freshly restored VISUALIZE script would send the raw
    // `visualize (...)` text to the backend.
    if (restoredNotebook != null) {
        const analyzeStartTime = performance.now();
        // Account per script: analyzeAllScriptsInNotebook reports the notebook's
        // script count up front and the outcome of each script as it finishes.
        // The work is synchronous, so we only need the totals to be correct once
        // it returns — the progressConsumer below reports the accumulated state.
        let scriptCount = 0;
        let scriptsReported = 0;
        const analyzeProgress: AnalyzeAllScriptsProgress = {
            onScriptCount: (count) => {
                scriptCount = count;
                analyzeNotebooks.addTotal(count).addStarted(count);
            },
            onScriptDone: (ok) => {
                scriptsReported++;
                if (ok) {
                    analyzeNotebooks.addSucceeded();
                } else {
                    analyzeNotebooks.addFailed();
                }
            },
        };
        try {
            restoredNotebook = analyzeAllScriptsInNotebook(restoredNotebook, logger, analyzeProgress);
            logger.info("Notebook scripts analyzed", {
                sessionId,
                scriptCount: scriptCount.toString(),
                durationMs: (performance.now() - analyzeStartTime).toFixed(2)
            }, LOG_CTX);
        } catch (analyzeError) {
            // Per-script failures are isolated inside analyzeAllScriptsInNotebook,
            // so reaching here is an unexpected wholesale failure. Lazy analysis
            // (editor/execute) still covers these scripts, so it must not abort the
            // session restore. Reconcile any scripts that never reported so the
            // counter can still complete.
            logger.warn("Failed to analyze notebook scripts, will analyze lazily", {
                sessionId,
                durationMs: (performance.now() - analyzeStartTime).toFixed(2),
                error: stringifyError(analyzeError)
            }, LOG_CTX);
            for (let i: number = scriptsReported; i < scriptCount; ++i) {
                analyzeNotebooks.addFailed();
            }
        }

        notebooks.set(sessionId, restoredNotebook);
        notebooksByConnection.set(sessionId, sessionId);
        notebooksByConnectionType[connectorInfo.connectorType].push(sessionId);
    }
    // A notebook that failed to restore contributes no scripts to analyze, so the
    // analyze counter is left untouched in that case.

    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebooks: restoreNotebooks.clone(),
        analyzeNotebooks: analyzeNotebooks.clone(),
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
    logger.info("Starting app state restoration", {}, LOG_CTX);
    const startTime = performance.now();

    const connectionStates = new Map<string, ConnectionState>();
    const connectionSignatures = new Map<string, string | null>();
    const notebooks = new Map<string, NotebookState>();
    const notebooksByConnection = new Map<string, string>();
    const invalidSessions = new Map<string, InvalidSession>();

    // Initialize indices (sized for all ConnectorType values: 0-3)
    const connectionStatesByType: string[][] = [[], [], [], []];
    const notebooksByConnectionType: string[][] = [[], [], [], []];

    // Initialize progress counters
    const restoreConnections = new ProgressCounter();
    const restoreCatalogs = new ProgressCounter();
    const restoreNotebooks = new ProgressCounter();
    const analyzeNotebooks = new ProgressCounter();

    try {
        // Load manifest
        logger.info("Loading app manifest", {}, LOG_CTX);
        const manifestStartTime = performance.now();
        const sessions = await backend.listSessions('dashql-manifest.json');
        const manifestDuration = performance.now() - manifestStartTime;

        logger.info("Loaded app manifest", {
            sessionCount: sessions.length.toString(),
            durationMs: manifestDuration.toFixed(2)
        }, LOG_CTX);

        // Set totals.
        //
        // analyzeNotebooks is counted per script, not per session, so its total
        // is accumulated as each notebook reports its script count in Phase 4
        // (see onScriptCount) rather than seeded here.
        restoreConnections.addTotal(sessions.length);
        restoreCatalogs.addTotal(sessions.length);
        restoreNotebooks.addTotal(sessions.length);

        progressConsumer({
            restoreConnections: restoreConnections.clone(),
            restoreCatalogs: restoreCatalogs.clone(),
            restoreNotebooks: restoreNotebooks.clone(),
            analyzeNotebooks: analyzeNotebooks.clone(),
        });

        // Process each session
        logger.info("Restoring sessions", { count: sessions.length.toString() }, LOG_CTX);
        for (let i = 0; i < sessions.length; i++) {
            const sessionEntry = sessions[i];
            const sessionStartTime = performance.now();

            try {
                logger.info("Restoring session", {
                    index: `${i + 1}/${sessions.length}`,
                    sessionPath: sessionEntry.path
                }, LOG_CTX);

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
                    analyzeNotebooks,
                    progressConsumer
                );

                const sessionDuration = performance.now() - sessionStartTime;
                logger.info("Session restored", {
                    index: `${i + 1}/${sessions.length}`,
                    sessionPath: sessionEntry.path,
                    durationMs: sessionDuration.toFixed(2)
                }, LOG_CTX);
            } catch (error) {
                const sessionDuration = performance.now() - sessionStartTime;

                if (error instanceof InvalidSessionError) {
                    // Metadata validation refused this session up front. Record it so the selector
                    // can show it as invalid (blocked, deletable), and account it as *skipped*
                    // rather than *failed* — nothing was attempted, the metadata was simply
                    // unusable. The session contributed no connection/catalog/notebook/scripts.
                    invalidSessions.set(error.invalid.sessionId, error.invalid);
                    restoreConnections.addSkipped();
                    restoreCatalogs.addSkipped();
                    restoreNotebooks.addSkipped();

                    progressConsumer({
                        restoreConnections: restoreConnections.clone(),
                        restoreCatalogs: restoreCatalogs.clone(),
                        restoreNotebooks: restoreNotebooks.clone(),
                        analyzeNotebooks: analyzeNotebooks.clone(),
                    });
                    continue;
                }

                logger.error("Failed to restore session", {
                    index: `${i + 1}/${sessions.length}`,
                    sessionPath: sessionEntry.path,
                    durationMs: sessionDuration.toFixed(2),
                    error: stringifyError(error)
                }, LOG_CTX);

                restoreConnections.addFailed();
                restoreCatalogs.addFailed();
                restoreNotebooks.addFailed();
                // analyzeNotebooks is counted per script: a session that fails
                // here failed before Phase 4 ran, so it contributed no scripts and
                // must not register a failure against the per-script counter.

                progressConsumer({
                    restoreConnections: restoreConnections.clone(),
                    restoreCatalogs: restoreCatalogs.clone(),
                    restoreNotebooks: restoreNotebooks.clone(),
                    analyzeNotebooks: analyzeNotebooks.clone(),
                });
            }
        }
    } catch (manifestError) {
        logger.warn("Failed to load manifest, starting with empty state", {
            error: stringifyError(manifestError)
        }, LOG_CTX);
    }

    // The analyze counter's total is accumulated per script during Phase 4. If no
    // notebook reached Phase 4 (empty manifest, or every session failed earlier),
    // it was never seeded — pin it to 0 so the indicator resolves to "nothing to
    // do" instead of an indefinite blank state.
    if (analyzeNotebooks.total == null) {
        analyzeNotebooks.addTotal(0);
    }
    progressConsumer({
        restoreConnections: restoreConnections.clone(),
        restoreCatalogs: restoreCatalogs.clone(),
        restoreNotebooks: restoreNotebooks.clone(),
        analyzeNotebooks: analyzeNotebooks.clone(),
    });

    const totalDuration = performance.now() - startTime;
    logger.info("Finished loading app state", {
        connections: connectionStates.size.toString(),
        notebooks: notebooks.size.toString(),
        invalidSessions: invalidSessions.size.toString(),
        connectionsSucceeded: restoreConnections.succeeded.toString(),
        connectionsFailed: restoreConnections.failed.toString(),
        connectionsSkipped: restoreConnections.skipped.toString(),
        totalDurationMs: totalDuration.toFixed(2)
    }, LOG_CTX);

    return {
        connectionStates,
        connectionStatesByType,
        connectionSignatures,
        notebooks,
        notebooksByConnection,
        notebooksByConnectionType,
        invalidSessions,
    };
}
