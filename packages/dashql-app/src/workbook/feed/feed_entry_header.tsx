import * as React from 'react';
import * as styles from './workbook_feed.module.css';
import type * as dashql from '@ankoh/dashql-core';

import type { Icon } from '../../ui/foundations/symbol_icon.js';
import { GraphIcon, LockIcon, PaperAirplaneIcon, PencilIcon, SquareFillIcon, SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { useRowContextMenu } from '../../ui/foundations/row_context_menu.js';
import { ConnectionHealth } from '@ankoh/dashql-sdk/connections/connection_state';
import type { ConnectorType } from '@ankoh/dashql-sdk/connections/connector_info';
import { useCancelQuery } from '../../connections/query_executor.js';
import { queryIsDone, type QueryExecutionState } from '@ankoh/dashql-sdk/query/query_execution_state';
import { ExecuteConnectionGuard, WorkbookConnectionAttentionContext } from '../workbook_connection_attention.js';
import { useWorkbookExecution } from '../scripts/workbook_execution_provider.js';
import type { ScriptData } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import { scriptDisplayName } from '@ankoh/dashql-sdk/workbook/scripts/script_types';
import { ScriptDiagnosticsButton } from '../scripts/script_diagnostics.js';
import { ScriptStatisticsBar } from '../scripts/script_statistics_bar.js';
import type { ScriptReferenceReport } from '@ankoh/dashql-sdk/workbook/scripts/script_reference_check';
import { ScriptActionMenu, type ScriptStorage } from '../scripts/script_action_menu.js';
import { ScriptConnectionPicker, type ScriptConnectionView } from '../scripts/script_connection_picker.js';
import { SnippetsOverlay } from '../snippets/snippets_overlay.js';
import { ChartBuilderOverlay } from '../chart_builder/chart_builder_overlay.js';
import { ScriptMentionTag } from './script_mention_tag.js';
import { classNames } from '../../utils/classnames.js';
import { useWorkbookReadOnly } from '../workbook_read_only.js';

const MoveUpIcon: Icon = SymbolIcon('chevron_up_16');
const MoveDownIcon: Icon = SymbolIcon('chevron_down_16');
const TrashIcon: Icon = SymbolIcon('trash_16');

export interface FeedEntryHeaderDependencies {
    useCancelQuery: typeof useCancelQuery;
    ScriptDiagnosticsButton: typeof ScriptDiagnosticsButton;
    ScriptStatisticsBar: typeof ScriptStatisticsBar;
    ChartBuilderOverlay: typeof ChartBuilderOverlay;
}

export const DEFAULT_FEED_ENTRY_HEADER_DEPENDENCIES: FeedEntryHeaderDependencies = {
    useCancelQuery,
    ScriptDiagnosticsButton,
    ScriptStatisticsBar,
    ChartBuilderOverlay,
};

export interface FeedEntryHeaderProps {
    workbookId: string;
    scriptData: ScriptData | undefined;
    scriptFileName: string;
    /// The connection the script runs on, null while it is not registered
    connection: ScriptConnectionView | null;
    connectorType: ConnectorType;
    /// The latest query of the script
    queryState: QueryExecutionState | null;
    /// A focused entry shows its run button in the base color
    focused: boolean;
    canExecute: boolean;
    scriptDebugMode: boolean;
    isFormattable: boolean;
    /// Formatting needs the editor of the script
    canFormat: boolean;
    /// The checked script references of the script
    scriptReferences: ScriptReferenceReport | null;
    /// Can a question of the composer target the script?
    canTarget: boolean;
    onTarget: () => void;
    onExecute: () => void;
    onPickConnection: (connectionId: string) => void;
    /// Rename the script, the name is the new display name
    onRename: (name: string) => void;
    onDelete: () => void;
    /// Open the script in an editor, an edit button left of the script menu offers it. Views without editors pass it,
    /// e.g. the dataflow.
    onEdit?: () => void;
    onFormat: (mode: dashql.buffers.formatting.FormattingMode) => void;
    /// Apply a snippet, the snippets button only shows with this handler
    onApplySnippet?: (text: string) => void;
    onSetVisSpec: (spec: string) => void;
    /// The storage path of the script, shown by the action menu
    storage: ScriptStorage;
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
    const dependencies = props.dependencies ?? DEFAULT_FEED_ENTRY_HEADER_DEPENDENCIES;
    const workbookExecution = useWorkbookExecution(props.workbookId);
    const cancelQuery = dependencies.useCancelQuery();
    const connectionAttention = React.useContext(WorkbookConnectionAttentionContext);
    const queryState = props.queryState;
    const queryActive = queryState != null && !queryIsDone(queryState.status);
    const hasPendingDiff = props.scriptData?.pendingDiff != null;
    const connectionId = props.connection?.connectionId ?? props.scriptData?.connection.connectionId ?? null;
    const connectionHealth = props.connection?.connectionHealth ?? null;
    // A script on a connection that is not connected keeps a greyed play button that pulses the connections in the bar
    const needsConnection = !queryActive && connectionId != null && connectionHealth !== ConnectionHealth.ONLINE;
    const displayName = scriptDisplayName(props.scriptFileName);
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
            <ExecuteConnectionGuard workbookId={props.workbookId} blocked={!queryActive && connectionHealth !== ConnectionHealth.ONLINE}>
            <IconButton
                className={needsConnection ? styles.feed_entry_execute_offline : props.focused ? styles.feed_entry_execute_focused : styles.feed_entry_execute_unfocused}
                variant={ButtonVariant.Invisible}
                size={ButtonSize.Small}
                aria-label={queryActive ? `Stop ${displayName} query` : `Execute ${displayName} query`}
                data-testid="script-execute"
                aria-current={props.focused ? 'true' : undefined}
                disabled={!queryActive && (workbookExecution.runActive || (needsConnection ? props.scriptData == null : !props.canExecute))}
                onClick={() => {
                    if (queryActive && props.scriptData?.latestQueryId != null) {
                        if (workbookExecution.busy) workbookExecution.stop();
                        else if (connectionId != null) cancelQuery(connectionId, props.scriptData.latestQueryId);
                    } else if (needsConnection) {
                        connectionAttention?.request(props.workbookId);
                    } else {
                        props.onExecute();
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
                    workbookId={props.workbookId}
                    scriptName={displayName}
                    connection={props.connection}
                    disabled={props.scriptData == null || queryActive || workbookExecution.busy}
                    onPick={props.onPickConnection}
                    entryHeader
                />
            </div>
            </>}
            {readOnly && <div className={styles.feed_entry_file_name} aria-hidden="true" />}
            {props.scriptDebugMode && props.scriptData != null && (
                <div className={styles.feed_entry_stats_bar} data-entry-optional="1">
                    <dependencies.ScriptStatisticsBar stats={props.scriptData.statistics} />
                </div>
            )}
            {props.scriptData != null && (
                <dependencies.ScriptDiagnosticsButton
                    scriptData={props.scriptData}
                    isFormattable={props.isFormattable}
                    connectorType={props.connectorType}
                    iconSize={14}
                    references={props.scriptReferences}
                />
            )}
            {props.scriptData?.annotations.manual && (
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
                canTarget={!readOnly && props.canTarget}
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
                disabled={props.scriptData == null || hasPendingDiff}
            >
                <GraphIcon size={14} />
            </IconButton>
            {chartBuilderOpen && props.scriptData != null && (
                <dependencies.ChartBuilderOverlay
                    scriptName={displayName}
                    visualizeQuery={props.scriptData.annotations.visualizeQuery}
                    queryState={queryState}
                    onChange={props.onSetVisSpec}
                    onClose={closeChartBuilder}
                />
            )}
            {props.onApplySnippet != null && (
                <span className={styles.feed_entry_optional} data-entry-optional="2">
                    <SnippetsOverlay
                        scriptName={displayName}
                        connectorType={props.connectorType}
                        disabled={props.scriptData == null || hasPendingDiff}
                        onApply={props.onApplySnippet}
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
                    disabled={props.scriptData == null}
                >
                    <PencilIcon size={14} />
                </IconButton>
            )}
            <ScriptActionMenu
                scriptName={displayName}
                formatDisabled={!props.isFormattable || hasPendingDiff || !props.canFormat}
                onFormat={props.onFormat}
                onDelete={props.onDelete}
                onRename={() => setRenaming(true)}
                onAddAbove={props.onAddAbove}
                onAddBelow={props.onAddBelow}
                storage={props.storage}
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
