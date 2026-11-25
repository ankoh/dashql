import * as React from 'react';
import * as styles from './workbook_feed.module.css';
import type * as dashql from '@akohn/dashql';
import type { EditorView } from '@codemirror/view';

import type { Icon } from '@akohn/dashql-react/components/symbol_icon';
import { GraphIcon, LockIcon, PaperAirplaneIcon, PencilIcon, SquareFillIcon, SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { useRowContextMenu } from '@akohn/dashql-react/dom/row_context_menu';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { queryIsDone } from '@akohn/dashql/platform/query/query_execution_state';
import { STORAGE_SCRIPTS_FOLDER } from '@akohn/dashql/platform/storage/storage_backend';
import { displayPath } from '@akohn/dashql/platform/storage/workbook_locator';
import { ExecuteConnectionGuard, WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import type { ScriptModel } from '@akohn/dashql-react/models/script_model';
import type { StorageReader } from '../../storage/storage_provider.js';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { ScriptDiagnosticsButton } from '../scripts/script_diagnostics.js';
import { ScriptStatisticsBar } from '../scripts/script_statistics_bar.js';
import type { ScriptReferenceReport } from '@akohn/dashql/platform/workbook/script_reference_check';
import { ScriptActionMenu, type ScriptStorage } from '../scripts/script_action_menu.js';
import { ScriptConnectionPicker, type ScriptConnectionView } from '../scripts/script_connection_picker.js';
import { SnippetsOverlay } from '../snippets/snippets_overlay.js';
import { ChartBuilderOverlay } from '../chart_builder/chart_builder_overlay.js';
import { ScriptMentionTag } from './script_mention_tag.js';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { useWorkbookReadOnly } from '../workbook_read_only.js';
import { formattingDialectForConnector, isScriptFormattable, useScriptText } from '../scripts/script_format.js';
import { formatScriptEditor } from '../editor/script_format_editor.js';

const MoveUpIcon: Icon = SymbolIcon('chevron_up_16');
const MoveDownIcon: Icon = SymbolIcon('chevron_down_16');
const TrashIcon: Icon = SymbolIcon('trash_16');

/// The parts of the header that need a real script session or editor, a test may replace them. None reads the runtime.
export interface FeedEntryHeaderDependencies {
    ScriptDiagnosticsButton: typeof ScriptDiagnosticsButton;
    ScriptStatisticsBar: typeof ScriptStatisticsBar;
    ChartBuilderOverlay: typeof ChartBuilderOverlay;
    formatScriptEditor: typeof formatScriptEditor;
    isScriptFormattable: typeof isScriptFormattable;
}

export const DEFAULT_FEED_ENTRY_HEADER_DEPENDENCIES: FeedEntryHeaderDependencies = {
    ScriptDiagnosticsButton,
    ScriptStatisticsBar,
    ChartBuilderOverlay,
    formatScriptEditor,
    isScriptFormattable,
};

/// How a view shows the header of a script
export interface FeedEntryHeaderDisplay {
    /// Is the script selected? A focused entry shows its run button in the base color.
    focused: boolean;
    /// Can a question of the composer target the script?
    canTarget: boolean;
    scriptDebugMode: boolean;
    formattingDebugMode: boolean;
    keywordCase: dashql.buffers.formatting.KeywordCase;
    /// The checked script references of the script
    references: ScriptReferenceReport | null;
}

export interface FeedEntryHeaderProps {
    /// The script with its latest query: the header runs, stops, formats and rewrites it through the model
    model: ScriptModel;
    /// The connection the script runs on, null while it is not registered. The script runs while it is online.
    connection: ScriptConnectionView | null;
    display: FeedEntryHeaderDisplay;
    /// The editor of the script, formatting needs it
    editorView: EditorView | null;
    /// Where the files of the workbook are, the action menu shows the path of the script
    storageReader: StorageReader;
    onTarget: () => void;
    onPickConnection: (connectionId: string) => void;
    /// Rename the script, the name is the new display name
    onRename: (name: string) => void;
    onDelete: () => void;
    /// Open the script in an editor, an edit button left of the script menu offers it. Views without editors pass it,
    /// e.g. the dataflow.
    onEdit?: () => void;
    /// Show the snippets button, true by default
    snippets?: boolean;
    /// Add a script above or below, in the feed order
    onAddAbove?: () => void;
    onAddBelow?: () => void;
    /// Move the script in the feed order, the buttons only show with these handlers
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    className?: string;
    dependencies?: FeedEntryHeaderDependencies;
}

/// The header of a script entry: run, connection, diagnostics, the name tag and the script actions.
/// The feed cards, the boxes of the dataflow and the script editor dialog share it.
export function FeedEntryHeader(props: FeedEntryHeaderProps): React.ReactElement {
    const { model, display } = props;
    const dependencies = props.dependencies ?? DEFAULT_FEED_ENTRY_HEADER_DEPENDENCIES;
    const connectionAttention = React.useContext(WorkbookConnectionAttentionContext);
    const script = model.script;
    const fileName = script.fileName;
    const queryState = model.query?.query ?? null;
    const queryActive = queryState != null && !queryIsDone(queryState.status);
    const hasPendingDiff = script.pendingDiff != null;
    const connectionHealth = props.connection?.connectionHealth ?? null;
    const connectorType = props.connection?.connectorInfo.connectorType ?? ConnectorType.HYPER;
    // A script on a connection that is not connected keeps a greyed play button that pulses the connections in the bar
    const needsConnection = !queryActive && connectionHealth !== ConnectionHealth.ONLINE;
    const displayName = scriptDisplayName(fileName);

    // Formattability only depends on the text, cursor moves bump the state revision but not the text version
    const formattingDialect = formattingDialectForConnector(connectorType);
    const scriptText = useScriptText(script);
    const { isScriptFormattable, formatScriptEditor } = dependencies;
    const isFormattable = React.useMemo(
        () => isScriptFormattable(scriptText, formattingDialect),
        [isScriptFormattable, scriptText, formattingDialect],
    );
    const { editorView } = props;
    const { formattingDebugMode, keywordCase } = display;
    const format = React.useCallback((mode: dashql.buffers.formatting.FormattingMode) => {
        formatScriptEditor(editorView, script, mode, text => void model.setText(text), formattingDebugMode, keywordCase, formattingDialect);
    }, [formatScriptEditor, editorView, script, model, formattingDebugMode, keywordCase, formattingDialect]);
    const { storageReader, onRename } = props;
    const workbookId = model.workbookId;
    const storage = React.useMemo<ScriptStorage>(() => ({
        fileName,
        resolvePath: () => `${displayPath(workbookId, storageReader.getWorkbookLocation(workbookId))}/${STORAGE_SCRIPTS_FOLDER}/${fileName}`,
        onRename,
    }), [fileName, workbookId, storageReader, onRename]);
    // Is the name being edited in the tag of the entry? Rename in the script menu starts it
    const [renaming, setRenaming] = React.useState(false);
    // A right click on the action bar opens the script menu
    const contextMenu = useRowContextMenu();
    const [chartBuilderOpen, setChartBuilderOpen] = React.useState(false);
    const closeChartBuilder = React.useCallback(() => setChartBuilderOpen(false), []);
    // A read-only workbook shows the connection, the diagnostics and the name, nothing that runs or changes the script
    const readOnly = useWorkbookReadOnly();

    return (
        <div className={classNames(styles.feed_entry_action_bar, props.className)} onContextMenu={readOnly ? undefined : contextMenu.onContextMenu}>
            {readOnly ? (
                <span className={styles.feed_entry_read_only} title="Read-only: import the workbook to run or change it"
                    role="img" aria-label="Read-only" data-testid="script-read-only">
                    <LockIcon size={14} />
                </span>
            ) : (
            <ExecuteConnectionGuard blocked={!queryActive && connectionHealth !== ConnectionHealth.ONLINE}>
            <IconButton
                className={needsConnection ? styles.feed_entry_execute_offline : display.focused ? styles.feed_entry_execute_focused : styles.feed_entry_execute_unfocused}
                variant={ButtonVariant.Invisible}
                size={ButtonSize.Small}
                aria-label={queryActive ? `Stop ${displayName} query` : `Execute ${displayName} query`}
                data-testid="script-execute"
                aria-current={display.focused ? 'true' : undefined}
                disabled={!queryActive && model.runActive}
                onClick={() => {
                    if (queryActive) {
                        void model.cancel();
                    } else if (needsConnection) {
                        connectionAttention?.request();
                    } else {
                        void model.run();
                    }
                }}
            >
                {queryActive ? <SquareFillIcon size={12} /> : <PaperAirplaneIcon size={14} />}
            </IconButton>
            </ExecuteConnectionGuard>
            )}
            {/* A read-only workbook runs on no connection, a preview maps its connections when it is imported */}
            {!readOnly && <>
            <span className={styles.feed_entry_action_separator} aria-hidden="true" />
            <div className={styles.feed_entry_file_name}>
                <ScriptConnectionPicker
                    workbookId={workbookId}
                    scriptName={displayName}
                    connection={props.connection}
                    disabled={queryActive || model.runActive}
                    onPick={props.onPickConnection}
                    entryHeader
                />
            </div>
            </>}
            {readOnly && <div className={styles.feed_entry_file_name} aria-hidden="true" />}
            {display.scriptDebugMode && (
                <div className={styles.feed_entry_stats_bar} data-entry-optional="1">
                    <dependencies.ScriptStatisticsBar stats={script.statistics} />
                </div>
            )}
            <dependencies.ScriptDiagnosticsButton
                scriptData={script}
                isFormattable={isFormattable}
                connectorType={connectorType}
                iconSize={14}
                references={display.references}
                editorView={editorView}
            />
            {script.annotations.manual && (
                <span
                    className={styles.feed_entry_manual}
                    title="Runs only on request (@manual): Execute All and input changes skip this script"
                    data-testid="script-manual"
                >
                    manual
                </span>
            )}
            <ScriptMentionTag
                scriptName={displayName}
                canTarget={!readOnly && display.canTarget}
                onTarget={props.onTarget}
                renaming={renaming}
                onRenamingChange={setRenaming}
                onRename={props.onRename}
            />
            {!readOnly && <>
            <IconButton
                variant={chartBuilderOpen ? ButtonVariant.Default : ButtonVariant.Invisible}
                size={ButtonSize.Small}
                onClick={(event) => { event.stopPropagation(); setChartBuilderOpen(true); }}
                aria-label={`Build a chart for ${displayName}`}
                aria-haspopup="dialog"
                aria-expanded={chartBuilderOpen}
                data-testid="script-chart"
                data-entry-optional="2"
                disabled={hasPendingDiff}
            >
                <GraphIcon size={14} />
            </IconButton>
            {/* The chart builder previews the result of the latest query, every edit of its spec is staged */}
            {chartBuilderOpen && (
                <dependencies.ChartBuilderOverlay
                    scriptName={displayName}
                    visualizeQuery={script.annotations.visualizeQuery}
                    model={model.query}
                    onChange={spec => void model.setVisSpec(spec)}
                    onClose={closeChartBuilder}
                />
            )}
            {/* A snippet replaces the text, a script with text stages the replacement as a diff */}
            {props.snippets !== false && (
                <span className={styles.feed_entry_optional} data-entry-optional="2">
                    <SnippetsOverlay
                        scriptName={displayName}
                        connectorType={connectorType}
                        disabled={hasPendingDiff}
                        onApply={text => void model.setText(text)}
                        iconSize={14}
                    />
                </span>
            )}
            {props.onEdit != null && (
                <IconButton
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    onClick={(event) => { event.stopPropagation(); props.onEdit?.(); }}
                    aria-label={`Edit ${displayName} script`}
                    data-testid="script-edit"
                >
                    <PencilIcon size={14} />
                </IconButton>
            )}
            <ScriptActionMenu
                scriptName={displayName}
                formatDisabled={!isFormattable || hasPendingDiff || editorView == null}
                onFormat={format}
                onDelete={props.onDelete}
                onRename={() => setRenaming(true)}
                onAddAbove={props.onAddAbove}
                onAddBelow={props.onAddBelow}
                storage={storage}
                iconSize={14}
                contextMenu={contextMenu}
            />
            <span className={styles.feed_entry_action_separator} aria-hidden="true" data-entry-optional="1" />
            <IconButton
                variant={ButtonVariant.Invisible}
                size={ButtonSize.Small}
                onClick={(event) => { event.stopPropagation(); props.onDelete(); }}
                aria-label={`Delete ${displayName} script`}
                data-testid="script-delete"
                data-entry-optional="1"
            >
                <TrashIcon size={14} />
            </IconButton>
            {props.onMoveUp != null && (
                <IconButton
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    onClick={(event) => { event.stopPropagation(); props.onMoveUp?.(); }}
                    aria-label="Move script up"
                    data-testid="script-move-up"
                    disabled={!props.canMoveUp}
                >
                    <MoveUpIcon size={14} />
                </IconButton>
            )}
            {props.onMoveDown != null && (
                <IconButton
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    onClick={(event) => { event.stopPropagation(); props.onMoveDown?.(); }}
                    aria-label="Move script down"
                    data-testid="script-move-down"
                    disabled={!props.canMoveDown}
                >
                    <MoveDownIcon size={14} />
                </IconButton>
            )}
            </>}
        </div>
    );
}
