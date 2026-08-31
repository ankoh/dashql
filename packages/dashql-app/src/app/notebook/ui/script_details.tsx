import * as React from 'react';
import * as styles from './script_details.module.css';
import * as dashql from '../../../core/index.js';
import { EditorView } from '@codemirror/view';
import { DashQLCompletionAbortEffect, DashQLCompletionStatus, DashQLProcessorPlugin } from '../scripts/editor/dashql_processor.js';

import type { Icon } from '../../../ui/foundations/symbol_icon.js';

import { ButtonSize, ButtonVariant, IconButton } from '../../../ui/foundations/button.js';
import { KeyEventHandler, useKeyEvents } from '../../../utils/key_events.js';
import { ConnectionHealth, ConnectionState } from '../connections/connection_state.js';
import { useCancelQuery, useQueryState, useQueryExecutor } from '../connections/query_executor.js';
import { QueryExecutionStatus } from '../connections/query_execution_state.js';
import { useAgentRunState, useCancelAgentRun } from '../agent/agent_run_provider.js';
import { ScriptDetailsTab } from './script_output_details.js';
import { QueryResultCacheLabel, QueryResultRerunButton } from './query_result_cache_controls.js';
import {
    ACCEPT_PENDING_DIFF,
    getSelectedScriptFolder,
    getSelectedScriptRef,
    NotebookScripts,
    REJECT_PENDING_DIFF,
    RENAME_SCRIPT,
    SELECT_SCRIPT_PATH,
} from '../scripts/notebook_scripts.js';
import { runNotebookScript } from './rerun_query.js';
import { useStorageReader } from '../persistence/storage_provider.js';
import { normalizeScriptFolderName, scriptDisplayName } from '../scripts/script_types.js';
import type { ModifyNotebookScripts } from '../scripts/notebook_scripts_registry.js';
import { useAppConfig } from '../../config/app_config.js';
import { acceptPendingDiff, rejectPendingDiff } from '../scripts/editor/dashql_diff_hint.js';
import { SymbolIcon } from '../../../ui/foundations/symbol_icon.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { ScriptDiagnosticsButton } from './script_diagnostics.js';
import * as ActionList from '../../../ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../../ui/foundations/anchored_overlay.js';
import { OverlaySize } from '../../../ui/foundations/overlay.js';
import { useScriptFormatPreview } from './script_format_preview.js';
import { ScriptDetailsEditorPane, ScriptDetailsOutputPane } from './script_details_panes.js';
import { VerticalSplit } from '../../../ui/foundations/vertical_split.js';

export { ScriptDetailsTab as TabKey };

export interface ScriptDetailsProps {
    notebookScripts: NotebookScripts;
    modifyNotebookScripts: ModifyNotebookScripts;
    connection: ConnectionState | null;
    hideDetails: () => void;
    scriptId?: number;
    initialTab?: ScriptDetailsTab;
    navigateToScript?: (scriptKey: number) => void;
}

interface ScriptFormatMenuProps {
    disabled: boolean;
    onFormat: (mode: dashql.buffers.formatting.FormattingMode) => void;
}

const ScriptFormatMenu: React.FC<ScriptFormatMenuProps> = (props) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const FormatIcon: Icon = SymbolIcon('pencil_ai_16');
    const selectFormat = React.useCallback((mode: dashql.buffers.formatting.FormattingMode) => {
        setIsOpen(false);
        props.onFormat(mode);
    }, [props.onFormat]);

    return (
        <AnchoredOverlay
            open={isOpen}
            onOpen={() => setIsOpen(true)}
            onClose={() => setIsOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={4}
            width={OverlaySize.S}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            focusZoneSettings={{ disabled: true }}
            renderAnchor={(anchorProps) => (
                <IconButton
                    {...anchorProps}
                    ref={triggerRef}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label="Format script"
                    disabled={props.disabled}
                >
                    <FormatIcon size={16} />
                </IconButton>
            )}
        >
            <div className={styles.format_menu} role="dialog" aria-label="Script formatting">
                <ActionList.List className={styles.format_menu_list} aria-label="Script formatting options">
                    <ActionList.ListItem
                        className={styles.format_menu_item}
                        onClick={() => selectFormat(dashql.buffers.formatting.FormattingMode.PRETTY)}
                    >
                        <ActionList.ItemText>Format Pretty</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem
                        className={styles.format_menu_item}
                        onClick={() => selectFormat(dashql.buffers.formatting.FormattingMode.COMPACT)}
                    >
                        <ActionList.ItemText>Format Compact</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
};

export const ScriptDetails: React.FC<ScriptDetailsProps> = (props) => {
    const config = useAppConfig();
    const logger = useLogger();
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    const [isFormattable, setIsFormattable] = React.useState(true);

    const selectedPage = getSelectedScriptFolder(props.notebookScripts);
    const notebookEntry = props.scriptId != null
        ? Object.values(selectedPage?.scripts ?? {}).find(entry => entry.scriptId === props.scriptId)
        : getSelectedScriptRef(props.notebookScripts);
    const scriptData = notebookEntry != null ? props.notebookScripts.scripts[notebookEntry.scriptId] : null;
    const hasExecution = scriptData?.latestQueryId != null || scriptData?.latestAgentRunId != null;
    const [resultExpanded, setResultExpanded] = React.useState(hasExecution);

    // Get folder name and script file name (display-only: strip the on-disk ordering prefix). The
    // raw scriptFileName stays the rename identity; the label and draft use the clean display name
    // (no prefix, no ".sql").
    const folderName = normalizeScriptFolderName(selectedPage?.folderName ?? '') || 'Untitled';
    const scriptFileName = notebookEntry?.fileName ?? '01-script.sql';
    const scriptDisplay = scriptDisplayName(scriptFileName);

    const PencilIcon: Icon = SymbolIcon('pencil_16');
    const CheckIcon: Icon = SymbolIcon('check_16');
    const FormatXIcon: Icon = SymbolIcon('x_16');
    const [isEditingName, setIsEditingName] = React.useState(false);
    const [draftFileName, setDraftFileName] = React.useState(scriptDisplay);
    const editInputRef = React.useRef<HTMLInputElement>(null);

    const startEditingName = React.useCallback((event?: React.MouseEvent) => {
        event?.stopPropagation();
        setDraftFileName(scriptDisplay);
        setIsEditingName(true);
    }, [scriptDisplay]);

    const saveNameEdit = React.useCallback(() => {
        const trimmed = draftFileName.trim();
        if (trimmed && trimmed !== scriptDisplay) {
            props.modifyNotebookScripts({ type: RENAME_SCRIPT, value: { fileName: scriptFileName, newFileName: trimmed } });
        }
        setIsEditingName(false);
    }, [draftFileName, scriptDisplay, scriptFileName, props.modifyNotebookScripts]);

    const cancelNameEdit = React.useCallback(() => {
        setIsEditingName(false);
    }, []);

    React.useEffect(() => {
        if (isEditingName && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [isEditingName]);

    React.useEffect(() => {
        setIsEditingName(false);
        setResultExpanded(hasExecution);
    }, [notebookEntry?.scriptId, hasExecution]);

    React.useEffect(() => {
        if (scriptData == null) {
            setIsFormattable(true);
            return;
        }
        const formattingConfig = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.HYPER,
            dashql.buffers.formatting.FormattingMode.PRETTY,
            80,
            4,
        );
        try {
            setIsFormattable(scriptData.scriptSession.isFullyFormattable(formattingConfig, true));
        } catch {
            setIsFormattable(false);
        }
    }, [scriptData?.scriptSession, scriptData?.editorUpdate?.stateRevision]);

    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;
    const {
        formatPending,
        format: handleFormat,
        acceptFormat: handleFormatAccept,
        cancelFormat: handleFormatCancel,
    } = useScriptFormatPreview(editorView, scriptData, formattingDebugMode);

    // A staged agent rewrite is shown as an in-place diff on the editable editor here (the diff
    // decorations + ⏎/⎋ keymap come from the editor's DashQL extensions). Surface visible controls
    // too, mirroring the feed's status bar. Both drive the editor-effect accept/reject path, which
    // round-trips through UPDATE_FROM_PROCESSOR to clear the pending diff.
    const hasPendingDiff = scriptData?.pendingDiff != null;
    const handleAcceptDiff = React.useCallback(() => {
        if (editorView != null) {
            acceptPendingDiff(editorView);
        } else if (scriptData != null) {
            props.modifyNotebookScripts({ type: ACCEPT_PENDING_DIFF, value: scriptData.scriptKey });
        }
    }, [editorView, props.modifyNotebookScripts, scriptData]);
    const handleRejectDiff = React.useCallback(() => {
        if (editorView != null) {
            rejectPendingDiff(editorView);
        } else if (scriptData != null) {
            props.modifyNotebookScripts({ type: REJECT_PENDING_DIFF, value: scriptData.scriptKey });
        }
    }, [editorView, props.modifyNotebookScripts, scriptData]);
    const navigateToScript = React.useCallback((scriptKey: number) => {
        if (props.navigateToScript) {
            props.navigateToScript(scriptKey);
            return;
        }
        const target = props.notebookScripts.scripts[scriptKey];
        if (!target?.folderName || !target.fileName) return;
        props.modifyNotebookScripts({
            type: SELECT_SCRIPT_PATH,
            value: { folderName: target.folderName, fileName: target.fileName },
        });
    }, [props.navigateToScript, props.notebookScripts.scripts, props.modifyNotebookScripts]);

    const activeQueryId = scriptData?.latestQueryId ?? null;
    const activeQueryState = useQueryState(props.notebookScripts?.notebookId ?? null, activeQueryId);
    const autoCollapsedQueryIdRef = React.useRef<number | null>(null);
    React.useEffect(() => {
        const queryId = activeQueryState?.queryId ?? activeQueryId;
        if (activeQueryState?.status === QueryExecutionStatus.SUCCEEDED
            && activeQueryState.resultTable === null) {
            if (autoCollapsedQueryIdRef.current === queryId) return;
            autoCollapsedQueryIdRef.current = queryId;
            setResultExpanded(false);
            return;
        }
        if (autoCollapsedQueryIdRef.current != null && autoCollapsedQueryIdRef.current !== queryId) {
            autoCollapsedQueryIdRef.current = null;
            setResultExpanded(true);
        }
    }, [activeQueryId, activeQueryState]);
    const handleToggleResultExpanded = React.useCallback(() => {
        setResultExpanded(expanded => !expanded);
    }, []);
    const cancelQuery = useCancelQuery();
    const cancelAgentRun = useCancelAgentRun();

    // Refresh: drop the stale cache entry for this result, then re-execute — a plain cacheable run
    // then misses the cache and re-populates it. Surfaced on the Data/Chart tab headers when the
    // current result was served from cache.
    const executeQuery = useQueryExecutor();
    const storageReader = useStorageReader();
    const handleExecute = React.useCallback(() => {
        if (scriptData == null || props.connection?.connectionHealth !== ConnectionHealth.ONLINE) {
            return;
        }
        runNotebookScript(props.connection.connectionId, props.notebookScripts, scriptData, executeQuery, props.modifyNotebookScripts, logger);
    }, [props.connection?.connectionHealth, props.notebookScripts, props.modifyNotebookScripts, scriptData, executeQuery, logger]);
    const handleRerun = React.useCallback(async (cacheKey: string | null) => {
        if (scriptData == null) {
            return;
        }
        // Best-effort delete of the stale cache entry first; the re-execution then misses and
        // re-populates the cache (the executor's write path overwrites it either way).
        if (cacheKey != null) {
            await storageReader.backend.deleteQueryResultCache(props.notebookScripts.notebookId, cacheKey).catch(() => { });
        }
        if (props.connection != null) {
            runNotebookScript(props.connection.connectionId, props.notebookScripts, scriptData, executeQuery, props.modifyNotebookScripts, logger);
        }
    }, [props.notebookScripts, props.modifyNotebookScripts, scriptData, executeQuery, storageReader, logger]);

    const agentRunState = useAgentRunState(scriptData?.latestAgentRunId ?? null);
    const visualizeQuery = scriptData?.annotations.visualizeQuery ?? null;

    const keyHandlers = React.useMemo<KeyEventHandler[]>(
        () => [
            {
                // Execute the pinned Details script directly rather than letting the global command
                // resolve the hidden feed's mutable selection.
                key: 'e',
                ctrlKey: true,
                capture: true,
                callback: (event) => {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    handleExecute();
                },
            },
            {
                key: 'Escape',
                ctrlKey: false,
                capture: true,
                callback: (event) => {
                    if (isEditingName) {
                        cancelNameEdit();
                        event.stopImmediatePropagation();
                        return;
                    }
                    if (editorView) {
                        const processor = editorView.state.field(DashQLProcessorPlugin, false);
                        if (processor?.scriptCompletion?.status === DashQLCompletionStatus.AVAILABLE) {
                            editorView.dispatch({ effects: DashQLCompletionAbortEffect.of(null) });
                            event.stopImmediatePropagation();
                            return;
                        }
                    }
                    props.hideDetails();
                    event.stopImmediatePropagation();
                },
            },
        ],
        [props.hideDetails, isEditingName, cancelNameEdit, editorView, handleExecute],
    );
    useKeyEvents(keyHandlers);

    React.useEffect(() => {
        if (editorView == null || (props.initialTab != null && props.initialTab !== ScriptDetailsTab.Editor)) {
            return;
        }
        const handle = requestAnimationFrame(() => {
            editorView.focus();
        });
        return () => cancelAnimationFrame(handle);
    }, [editorView, props.initialTab]);


    if (notebookEntry == null || scriptData == null) {
        return <div className={styles.entry_body_container} />;
    }

    const ScreenNormalIcon: Icon = SymbolIcon('screen_normal_16');
    const PersonIcon: Icon = SymbolIcon('person_16');
    const connectorIcon = props.connection?.connectorInfo?.icons?.outlines ?? 'database_16';
    const tableDebugMode = config?.settings?.tableDebugMode ?? false;
    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    return (
        <div className={styles.entry_body_container}>
            <div
                key={notebookEntry?.scriptId}
                className={styles.entry_single}
            >
                <VerticalSplit
                    className={styles.entry_split}
                    defaultRatio={0.4}
                    minFirstSize={160}
                    minSecondSize={120}
                    secondCollapsed={!resultExpanded}
                    collapsedSecondSize={40}
                    separatorLabel="Resize script editor and result"
                    first={(
                        <ScriptDetailsEditorPane
                            notebookId={props.notebookScripts.notebookId}
                            scriptData={scriptData}
                            folderName={folderName}
                            scriptDisplay={scriptDisplay}
                            scriptDebugMode={scriptDebugMode}
                            executeDisabled={props.connection?.connectionHealth !== ConnectionHealth.ONLINE}
                            isEditingName={isEditingName}
                            draftFileName={draftFileName}
                            editInputRef={editInputRef}
                            isFormattable={isFormattable}
                            formatPending={formatPending}
                            hasPendingDiff={hasPendingDiff}
                            PencilIcon={PencilIcon}
                            CheckIcon={CheckIcon}
                            CancelIcon={FormatXIcon}
                            CollapseIcon={ScreenNormalIcon}
                            PersonIcon={PersonIcon}
                            formatMenu={<ScriptFormatMenu disabled={formatPending || hasPendingDiff} onFormat={handleFormat} />}
                            onExecute={handleExecute}
                            onHide={props.hideDetails}
                            onStartEditingName={startEditingName}
                            onDraftFileNameChange={setDraftFileName}
                            onSaveName={saveNameEdit}
                            onCancelName={cancelNameEdit}
                            onEditorView={setEditorView}
                            onNavigateToScript={navigateToScript}
                            onAcceptDiff={handleAcceptDiff}
                            onRejectDiff={handleRejectDiff}
                            onAcceptFormat={handleFormatAccept}
                            onCancelFormat={handleFormatCancel}
                        />
                    )}
                    second={(
                        <ScriptDetailsOutputPane
                            query={activeQueryState}
                            agentRun={agentRunState}
                            visualizeQuery={visualizeQuery}
                            initialTab={props.initialTab}
                            tableDebugMode={tableDebugMode}
                            connectorIcon={connectorIcon}
                            expanded={resultExpanded}
                            onToggleExpanded={handleToggleResultExpanded}
                            contentId={`script-result-${scriptData.scriptKey}`}
                            onCancelQuery={activeQueryId != null
                                ? () => props.connection && cancelQuery(props.connection.connectionId, activeQueryId)
                                : undefined}
                            onCancelAgent={() => cancelAgentRun(props.notebookScripts.notebookId)}
                            statusActions={(
                                <>
                                    <QueryResultCacheLabel query={activeQueryState} />
                                    <QueryResultRerunButton query={activeQueryState} onRerun={handleRerun} />
                                    <IconButton variant={ButtonVariant.Invisible} onClick={props.hideDetails} aria-label="Close script details">
                                        <ScreenNormalIcon size={16} />
                                    </IconButton>
                                </>
                            )}
                        />
                    )}
                />
            </div>
        </div>
    );
};
