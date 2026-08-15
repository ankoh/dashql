import * as React from 'react';
import * as styles from './script_details.module.css';
import * as dashql from '../../../shared/core/index.js';
import { EditorView } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
import { DashQLCompletionAbortEffect, DashQLCompletionStatus, DashQLProcessorPlugin } from '../scripts/editor/dashql_processor.js';

import { PaperAirplaneIcon } from '@primer/octicons-react';
import type { Icon } from '@primer/octicons-react';

import { ButtonSize, ButtonVariant, IconButton } from '../../../shared/ui/foundations/button.js';
import { ButtonGroup } from '../../../shared/ui/foundations/button_group.js';
import { KeyEventHandler, useKeyEvents } from '../../../shared/utils/key_events.js';
import { ConnectionHealth, ConnectionState } from '../connections/connection_state.js';
import { useCancelQuery, useQueryState, useQueryExecutor } from '../connections/query_executor.js';
import { useAgentRunState, useCancelAgentRun } from '../agent/agent_run_provider.js';
import { ScriptOutputDetails, ScriptDetailsTab } from './script_output_details.js';
import { QueryResultCacheLabel, QueryResultRerunButton } from './query_result_cache_controls.js';
import { ACCEPT_PENDING_DIFF, getSelectedScriptRef, getSelectedScriptFolder, NotebookScripts, REJECT_PENDING_DIFF, RENAME_SCRIPT, SELECT_SCRIPT_PATH } from '../scripts/notebook_scripts.js';
import { rerunEntry } from './rerun_query.js';
import { useStorageReader } from '../persistence/storage_provider.js';
import { normalizeScriptFolderName, scriptDisplayName } from '../scripts/script_types.js';
import type { ModifyNotebookScripts } from '../scripts/notebook_scripts_registry.js';
import { useAppConfig } from '../../config/app_config.js';
import { ScriptEditor } from './script_editor.js';
import { acceptPendingDiff, rejectPendingDiff } from '../scripts/editor/dashql_diff_hint.js';
import { SymbolIcon } from '../../../shared/ui/foundations/symbol_icon.js';
import { ScriptName } from './script_name.js';
import { ScriptStatisticsBar } from './script_statistics_bar.js';
import { createReadonlyCodeMirrorExtensions } from '../scripts/editor/codemirror.js';
import { DashQLUpdateEffect, DashQLScriptBuffers, analyzeScript } from '../scripts/editor/dashql_processor.js';
import { useLogger } from '../../../shared/platform/logger/logger_provider.js';
import { ScriptDiagnosticsButton } from './script_diagnostics.js';
import * as ActionList from '../../../shared/ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../../../shared/ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../../shared/ui/foundations/anchored_overlay.js';
import { OverlaySize } from '../../../shared/ui/foundations/overlay.js';

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
    canConvertToSQL: boolean;
    onFormat: (mode: dashql.buffers.formatting.FormattingMode, lowerRelationalPipes: boolean) => void;
}

const ScriptFormatMenu: React.FC<ScriptFormatMenuProps> = (props) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const FormatIcon: Icon = SymbolIcon('pencil_ai_16');
    const selectFormat = React.useCallback((
        mode: dashql.buffers.formatting.FormattingMode,
        lowerRelationalPipes: boolean,
    ) => {
        setIsOpen(false);
        props.onFormat(mode, lowerRelationalPipes);
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
                        onClick={() => selectFormat(dashql.buffers.formatting.FormattingMode.PRETTY, false)}
                    >
                        <ActionList.ItemText>Format Pretty</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem
                        className={styles.format_menu_item}
                        onClick={() => selectFormat(dashql.buffers.formatting.FormattingMode.COMPACT, false)}
                    >
                        <ActionList.ItemText>Format Compact</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem
                        className={styles.format_menu_item}
                        disabled={!props.canConvertToSQL}
                        onClick={() => selectFormat(dashql.buffers.formatting.FormattingMode.PRETTY, true)}
                    >
                        <ActionList.ItemText>Convert to SQL</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
};

export const ScriptDetails: React.FC<ScriptDetailsProps> = (props) => {
    const config = useAppConfig();
    const logger = useLogger();
    const showServerDetails = props.initialTab != null && props.initialTab !== ScriptDetailsTab.Editor;
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    const [formatPending, setFormatPending] = React.useState(false);
    const [isFormattable, setIsFormattable] = React.useState(true);
    const savedEditorStateRef = React.useRef<EditorState | null>(null);
    const formattedTextRef = React.useRef<string | null>(null);
    const formatPreviewBuffersRef = React.useRef<DashQLScriptBuffers | null>(null);
    const formatPreviewScriptRef = React.useRef<dashql.DashQLScript | null>(null);

    const selectedPage = getSelectedScriptFolder(props.notebookScripts);
    const notebookEntry = props.scriptId != null
        ? Object.values(selectedPage?.scripts ?? {}).find(entry => entry.scriptId === props.scriptId)
        : getSelectedScriptRef(props.notebookScripts);
    const scriptData = notebookEntry != null ? props.notebookScripts.scripts[notebookEntry.scriptId] : null;

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
        if (formatPending) {
            formatPreviewBuffersRef.current?.destroy(formatPreviewBuffersRef.current);
            formatPreviewBuffersRef.current = null;
            formatPreviewScriptRef.current?.ptr.destroy();
            formatPreviewScriptRef.current = null;
            savedEditorStateRef.current = null;
            formattedTextRef.current = null;
            setFormatPending(false);
        }
    }, [notebookEntry?.scriptId]);

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
            setIsFormattable(scriptData.script.isFullyFormattable(formattingConfig, true));
        } catch {
            setIsFormattable(false);
        }
    }, [scriptData?.script, scriptData?.scriptAnalysis.buffers]);

    const handleFormat = React.useCallback((
        mode: dashql.buffers.formatting.FormattingMode,
        lowerRelationalPipes: boolean,
    ) => {
        if (editorView == null || scriptData == null) return;
        try {
            const config = new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.HYPER,
                mode,
                80,
                4,
                false,
                lowerRelationalPipes,
            );
            const formattedScript = scriptData.script.format(config, null);
            const formattedText = formattedScript.toString();

            const currentText = editorView.state.doc.toString();
            if (formattedText === currentText) {
                formattedScript.ptr.destroy();
                return;
            }

            formattedScript.parse();
            const previewBuffers = analyzeScript(formattedScript);

            savedEditorStateRef.current = editorView.state;
            formattedTextRef.current = formattedText;
            formatPreviewBuffersRef.current?.destroy(formatPreviewBuffersRef.current);
            formatPreviewBuffersRef.current = previewBuffers;
            formatPreviewScriptRef.current?.ptr.destroy();
            formatPreviewScriptRef.current = formattedScript;

            const readonlyExtensions = createReadonlyCodeMirrorExtensions();
            const previewState = EditorState.create({
                doc: formattedText,
                extensions: readonlyExtensions,
            });
            editorView.setState(previewState);
            editorView.contentDOM.blur();

            editorView.dispatch({
                effects: [
                    DashQLUpdateEffect.of({
                        scriptKey: formattedScript.getCatalogEntryId(),
                        script: formattedScript,
                        scriptBuffers: previewBuffers,
                        scriptCursor: null,
                        scriptCompletion: null,
                        scriptPendingDiff: null,
                        derivedFocus: null,
                        onUpdate: () => { },
                    }),
                ],
            });

            setFormatPending(true);
        } catch {
            // Format failed
        }
    }, [editorView, scriptData]);

    const handleFormatAccept = React.useCallback(() => {
        if (editorView == null || savedEditorStateRef.current == null || formattedTextRef.current == null) return;

        document.getSelection()?.removeAllRanges();
        editorView.setState(savedEditorStateRef.current);
        editorView.dispatch({
            changes: { from: 0, to: editorView.state.doc.length, insert: formattedTextRef.current },
            selection: EditorSelection.cursor(0),
        });

        formatPreviewBuffersRef.current?.destroy(formatPreviewBuffersRef.current);
        formatPreviewBuffersRef.current = null;
        formatPreviewScriptRef.current?.ptr.destroy();
        formatPreviewScriptRef.current = null;
        savedEditorStateRef.current = null;
        formattedTextRef.current = null;
        setFormatPending(false);
    }, [editorView]);

    const handleFormatCancel = React.useCallback(() => {
        if (editorView == null || savedEditorStateRef.current == null) return;

        document.getSelection()?.removeAllRanges();
        editorView.setState(savedEditorStateRef.current);
        editorView.dispatch({
            selection: EditorSelection.cursor(0),
        });

        formatPreviewBuffersRef.current?.destroy(formatPreviewBuffersRef.current);
        formatPreviewBuffersRef.current = null;
        formatPreviewScriptRef.current?.ptr.destroy();
        formatPreviewScriptRef.current = null;
        savedEditorStateRef.current = null;
        formattedTextRef.current = null;
        setFormatPending(false);
    }, [editorView]);

    React.useEffect(() => {
        return () => {
            formatPreviewBuffersRef.current?.destroy(formatPreviewBuffersRef.current);
            formatPreviewScriptRef.current?.ptr.destroy();
        };
    }, []);

    // A staged agent rewrite is shown as an in-place diff on the editable editor here (the diff
    // decorations + ⏎/⎋ keymap come from the editor's DashQL extensions). Surface visible controls
    // too, mirroring the feed's status bar. Both drive the editor-effect accept/reject path, which
    // round-trips through UPDATE_FROM_PROCESSOR to clear the pending diff.
    const hasPendingDiff = scriptData?.pendingDiff != null;
    let canConvertToSQL = false;
    try {
        const parsed = scriptData?.scriptAnalysis.buffers.parsed?.read() ?? null;
        canConvertToSQL = parsed != null &&
            (parsed.featureFlags() & dashql.buffers.parser.ParsedScriptFeature.RELATIONAL_PIPE) !== 0;
    } catch {
        canConvertToSQL = false;
    }
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
    const cancelQuery = useCancelQuery();
    const cancelAgentRun = useCancelAgentRun();

    // Refresh: drop the stale cache entry for this result, then re-execute — a plain cacheable run
    // then misses the cache and re-populates it. Surfaced on the Data/Chart tab headers when the
    // current result was served from cache.
    const executeQuery = useQueryExecutor();
    const storageReader = useStorageReader();
    const handleExecuteAndHide = React.useCallback(() => {
        props.hideDetails();
        if (scriptData == null || props.connection?.connectionHealth !== ConnectionHealth.ONLINE) {
            return;
        }
        rerunEntry(props.notebookScripts, scriptData, executeQuery, props.modifyNotebookScripts, logger);
    }, [props.hideDetails, props.connection?.connectionHealth, props.notebookScripts, props.modifyNotebookScripts, scriptData, executeQuery, logger]);
    const handleRerun = React.useCallback(async (cacheKey: string | null) => {
        if (scriptData == null) {
            return;
        }
        // Best-effort delete of the stale cache entry first; the re-execution then misses and
        // re-populates the cache (the executor's write path overwrites it either way).
        if (cacheKey != null) {
            await storageReader.backend.deleteQueryResultCache(props.notebookScripts.notebookId, cacheKey).catch(() => {});
        }
        rerunEntry(props.notebookScripts, scriptData, executeQuery, props.modifyNotebookScripts, logger);
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
                    handleExecuteAndHide();
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
        [props.hideDetails, isEditingName, cancelNameEdit, editorView, handleExecuteAndHide],
    );
    useKeyEvents(keyHandlers);

    React.useEffect(() => {
        if (editorView == null) {
            return;
        }
        const handle = requestAnimationFrame(() => {
            editorView.focus();
        });
        return () => cancelAnimationFrame(handle);
    }, [editorView]);


    if (notebookEntry == null || scriptData == null) {
        return <div className={styles.entry_body_container} />;
    }

    const ScreenNormalIcon: Icon = SymbolIcon('screen_normal_16');
    const tableDebugMode = config?.settings?.tableDebugMode ?? false;
    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    // Script-card activation opens the editor (no initial tab). Any explicit output tab comes from
    // the server card and opens a response-only Details view.
    return (
        <div className={styles.entry_body_container}>
            <div
                key={notebookEntry?.scriptId}
                className={styles.entry_single}
            >
                {!showServerDetails && (
                <div className={styles.entry_message_single}>
                    <div className={styles.entry_script_card}>
                        <div className={styles.entry_card_action_bar}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label={`Execute ${scriptDisplay} query`}
                            disabled={props.connection?.connectionHealth !== ConnectionHealth.ONLINE}
                            onClick={handleExecuteAndHide}
                        >
                            <PaperAirplaneIcon size={16} />
                        </IconButton>
                        <div className={styles.entry_card_file_name}>
                            <ScriptName
                                folder={folderName}
                                file={scriptDisplay}
                                onFolderClick={props.hideDetails}
                                onFileClick={startEditingName}
                                editing={isEditingName ? {
                                    value: draftFileName,
                                    onChange: setDraftFileName,
                                    onCommit: saveNameEdit,
                                    onCancel: cancelNameEdit,
                                    inputRef: editInputRef,
                                } : undefined}
                                fileNameTrailing={
                                    <span className={styles.entry_card_file_name_actions}>
                                        <IconButton
                                            variant={ButtonVariant.Invisible}
                                            size={ButtonSize.Tiny}
                                            aria-label="Rename script"
                                            onClick={startEditingName}
                                            className={styles.entry_card_file_name_action_button}
                                        >
                                            <PencilIcon size={12} />
                                        </IconButton>
                                    </span>
                                }
                            />
                        </div>
                        {scriptDebugMode && scriptData != null && (
                            <div className={styles.entry_card_stats_bar}>
                                <ScriptStatisticsBar stats={scriptData.statistics} />
                            </div>
                        )}
                            <div className={styles.entry_card_trailing_actions}>
                                <ScriptDiagnosticsButton
                                    scriptData={scriptData}
                                    isFormattable={isFormattable}
                                />
                                <ScriptFormatMenu
                                    disabled={formatPending || hasPendingDiff}
                                    canConvertToSQL={canConvertToSQL}
                                    onFormat={handleFormat}
                                />
                                <IconButton
                                    className={styles.entry_card_collapse_button}
                                    variant={ButtonVariant.Invisible}
                                    onClick={props.hideDetails}
                                    aria-label="Collapse"
                                >
                                    <ScreenNormalIcon size={16} />
                                </IconButton>
                            </div>
                        </div>
                        <div className={styles.script_body}>
                            <div className={styles.editor_container}>
                                <ScriptEditor
                                    notebookId={props.notebookScripts.notebookId}
                                    scriptKey={notebookEntry.scriptId}
                                    setView={setEditorView}
                                    onNavigateToScript={navigateToScript}
                                />
                                <div className={styles.format_toggle}>
                                    {hasPendingDiff ? (
                                        <ButtonGroup>
                                            <IconButton
                                                variant={ButtonVariant.Default}
                                                onClick={handleAcceptDiff}
                                                aria-label="Accept rewrite"
                                            >
                                                <CheckIcon />
                                            </IconButton>
                                            <IconButton
                                                variant={ButtonVariant.Default}
                                                onClick={handleRejectDiff}
                                                aria-label="Reject rewrite"
                                            >
                                                <FormatXIcon />
                                            </IconButton>
                                        </ButtonGroup>
                                    ) : formatPending ? (
                                        <ButtonGroup>
                                            <IconButton
                                                variant={ButtonVariant.Default}
                                                onClick={handleFormatAccept}
                                                aria-label="Accept format"
                                            >
                                                <CheckIcon />
                                            </IconButton>
                                            <IconButton
                                                variant={ButtonVariant.Default}
                                                onClick={handleFormatCancel}
                                                aria-label="Cancel format"
                                            >
                                                <FormatXIcon />
                                            </IconButton>
                                        </ButtonGroup>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                )}
                {showServerDetails && (
                <div className={styles.entry_message_single}>
                    <ScriptOutputDetails
                        query={activeQueryState}
                        agentRun={agentRunState}
                        visualizeQuery={visualizeQuery}
                        initialTab={props.initialTab}
                        tableDebugMode={tableDebugMode}
                        onCancelQuery={activeQueryId != null
                            ? () => cancelQuery(props.notebookScripts.notebookId, activeQueryId)
                            : undefined}
                        onCancelAgent={() => cancelAgentRun(props.notebookScripts.notebookId)}
                        onClose={props.hideDetails}
                        statusActions={(
                            <>
                                <QueryResultCacheLabel query={activeQueryState} />
                                <QueryResultRerunButton query={activeQueryState} onRerun={handleRerun} />
                                <IconButton
                                    variant={ButtonVariant.Invisible}
                                    onClick={props.hideDetails}
                                    aria-label="Collapse"
                                >
                                    <ScreenNormalIcon size={16} />
                                </IconButton>
                            </>
                        )}
                    />
                </div>
                )}
            </div>
        </div>
    );
};
