import * as React from 'react';
import * as styles from './workbook_feed.module.css';
import * as dashql from '@akohn/dashql';

import type { EditorView } from '@codemirror/view';
import type { Icon } from '../../ui/foundations/symbol_icon.js';

import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ButtonGroup } from '../../ui/foundations/button_group.js';
import { IndicatorStatus } from '../../ui/foundations/status_indicator.js';
import { SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { STORAGE_SCRIPTS_FOLDER } from '@akohn/dashql/platform/storage/storage_backend';
import type { ScriptReferenceReport } from '@akohn/dashql/platform/workbook/script_reference_check';
import type { StorageReader } from '../../storage/storage_provider.js';
import { displayPath } from '../../storage/workbook_locator.js';
import type { ScriptModel } from '../../runtime/models/script_model.js';
import { deriveEntryStatus, EntryStatusKind } from '../entry_status_model.js';
import { EntryStatusBar } from '../entry_status_bar.js';
import { CachedResultBean, QueryResultRerunButton } from '../persistence/query_result_cache_controls.js';
import { DEFAULT_FEED_ENTRY_HEADER_DEPENDENCIES, FeedEntryHeader, type FeedEntryHeaderDependencies } from './feed_entry_header.js';
import { FeedEntryTabStrip, useFeedEntryTabs, type FeedEntryTab } from './feed_entry_footer.js';
import { formattingDialectForConnector, isScriptFormattable } from '../scripts/script_format.js';
import { formatScriptEditor } from '../editor/script_format_editor.js';
import type { ScriptStorage } from '../scripts/script_action_menu.js';
import type { ScriptConnectionView } from '../scripts/script_connection_picker.js';
import { useWorkbookReadOnly } from '../workbook_read_only.js';

// The card of a script in the feed (docs/agents/writing_components.md). It shows a script model and the state of the
// feed and imports nothing of the runtime: the model runs, cancels and rewrites the script, the feed commands change
// the feed, and the parts that read the runtime themselves come in as slots that the row renders.

/// What the feed does for a script, by its file name: the commands that change the scripts of the feed, their order
/// and the selection. The model of the script does the rest.
export interface ScriptFeedCommands {
    /// Add a script at a position of the feed
    create(index: number): void;
    /// Select the script
    focus(fileName: string): void;
    delete(fileName: string): void;
    /// Rename the script, the references in the other scripts and in the draft of the composer follow
    rename(oldFileName: string, newFileName: string): void;
    /// Run the script on another connection
    pickConnection(fileName: string, connectionId: string): void;
    moveUp(fileName: string): void;
    moveDown(fileName: string): void;
    /// Reference the script in the question of the composer
    target(fileName: string): void;
    /// The editor of a script mounted its view
    editorView(scriptKey: number, view: EditorView): void;
}

/// The place of the card in the feed
export interface ScriptCardPosition {
    index: number;
    canMoveUp: boolean;
    canMoveDown: boolean;
}

/// How the feed shows the card
export interface ScriptCardDisplay {
    /// Is the script selected?
    focused: boolean;
    /// Is the feed shown? A hidden feed mounts no editors.
    active: boolean;
    /// Can a question of the composer target the script?
    canTarget: boolean;
    scriptDebugMode: boolean;
    formattingDebugMode: boolean;
    keywordCase: dashql.buffers.formatting.KeywordCase;
    /// The checked script references of the script
    references: ScriptReferenceReport | null;
}

/// The result of the card, folded by the feed. A query without a result folds by itself, until the user unfolds it or
/// the next query starts.
export interface ScriptResultFold {
    expanded: boolean;
    toggle(scriptKey: number): void;
    autoCollapse(scriptKey: number, queryId: number): void;
    resetAutoCollapsed(scriptKey: number, queryId: number | null): void;
}

/// The slot of the editor of the script
export interface ScriptEditorSlot {
    className: string;
    onFocus: () => void;
    setView: (view: EditorView) => void;
}

/// The slot of the result of the latest query, in the tab of the status bar
export interface ScriptResultSlot {
    selectedTab: FeedEntryTab;
    /// Open the full result table over the feed
    onShowTable: () => void;
}

/// The slot of the full result table over the feed
export interface ScriptResultTableSlot {
    scriptName: string;
    onClose: () => void;
}

/// The parts of the card that need a real script session or editor, a test may replace them. None reads the runtime.
export interface ScriptCardDependencies extends FeedEntryHeaderDependencies {
    formatScriptEditor: typeof formatScriptEditor;
    isScriptFormattable: typeof isScriptFormattable;
}

export const DEFAULT_SCRIPT_CARD_DEPENDENCIES: ScriptCardDependencies = {
    ...DEFAULT_FEED_ENTRY_HEADER_DEPENDENCIES,
    formatScriptEditor,
    isScriptFormattable,
};

export interface ScriptCardProps {
    model: ScriptModel;
    /// The connection the script runs on, null while it is not registered
    connection: ScriptConnectionView | null;
    position: ScriptCardPosition;
    display: ScriptCardDisplay;
    result: ScriptResultFold;
    feed: ScriptFeedCommands;
    /// Where the files of the workbook are, the action menu shows the path of the script
    storageReader: StorageReader;
    editor: (slot: ScriptEditorSlot) => React.ReactNode;
    resultPanel: (slot: ScriptResultSlot) => React.ReactNode;
    resultTable: (slot: ScriptResultTableSlot) => React.ReactNode;
    dependencies?: ScriptCardDependencies;
}

const CheckIcon: Icon = SymbolIcon('check_16');
const CrossIcon: Icon = SymbolIcon('x_16');

// Memoized since every row of the feed re-renders whenever any script changes
export const ScriptCard: React.FC<ScriptCardProps> = React.memo((props: ScriptCardProps) => {
    const { model, connection, position, display, result, feed } = props;
    const dependencies = props.dependencies ?? DEFAULT_SCRIPT_CARD_DEPENDENCIES;
    const script = model.script;
    const scriptKey = script.scriptKey;
    const fileName = script.fileName;
    const query = model.query;
    const connectorType = connection?.connectorInfo.connectorType ?? ConnectorType.HYPER;
    const online = connection?.connectionHealth === ConnectionHealth.ONLINE;

    // A staged rewrite waiting to be accepted or rejected. The editor shows the diff in place, these buttons are the
    // explicit alternatives.
    const hasPendingDiff = script.pendingDiff != null;
    // The time the cached result of a run of the script was written, null if it is not cached
    const cachedAtMs = script.cachedResult?.cachedAt ?? null;
    const entryStatus = deriveEntryStatus(query, query?.progress ?? null);
    // The result tabs live in the status bar, their panel below it
    const resultTabs = useFeedEntryTabs(query, script.annotations.visualizeQuery ?? null);
    // Picking a tab of a folded result shows it
    const expandResult = React.useCallback(() => {
        if (!result.expanded) result.toggle(scriptKey);
    }, [scriptKey, result]);
    React.useEffect(() => {
        if (query?.status !== QueryExecutionStatus.SUCCEEDED || query.resultTable !== null) {
            result.resetAutoCollapsed(scriptKey, query?.queryId ?? script.latestQueryId ?? null);
            return;
        }
        result.autoCollapse(scriptKey, query.queryId);
    }, [result.autoCollapse, result.resetAutoCollapsed, script.latestQueryId, query, scriptKey]);
    const cancel = React.useCallback(() => {
        if (entryStatus.kind === EntryStatusKind.Query) void model.cancel();
    }, [model, entryStatus.kind]);

    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    const formattingDialect = formattingDialectForConnector(connectorType);
    // Formattability only depends on the text, cursor moves bump the state revision but not the text version
    const isFormattable = React.useMemo(
        () => dependencies.isScriptFormattable(script, formattingDialect),
        [script.scriptSession, script.editorUpdate?.textVersion, formattingDialect],
    );
    const handleEditorView = React.useCallback((view: EditorView) => {
        setEditorView(view);
        feed.editorView(scriptKey, view);
    }, [feed, scriptKey]);
    const handleFormat = React.useCallback((mode: dashql.buffers.formatting.FormattingMode) => {
        dependencies.formatScriptEditor(editorView, script, mode, text => void model.setText(text),
            display.formattingDebugMode, display.keywordCase, formattingDialect);
    }, [editorView, script, model, display.formattingDebugMode, display.keywordCase, formattingDialect]);

    // Labels use the display name (the file name without ".sql"), the file name stays the identity of the commands
    const displayName = scriptDisplayName(fileName);
    const storage = React.useMemo<ScriptStorage>(() => ({
        fileName,
        resolvePath: () => `${displayPath(model.workbookId, props.storageReader.getWorkbookLocation(model.workbookId))}/${STORAGE_SCRIPTS_FOLDER}/${fileName}`,
        onRename: name => feed.rename(fileName, name),
    }), [fileName, model.workbookId, props.storageReader, feed]);

    // The full result table opens in a card over the feed
    const [tableOpen, setTableOpen] = React.useState(false);
    const showTable = React.useCallback(() => setTableOpen(true), []);
    const closeTable = React.useCallback(() => setTableOpen(false), []);

    const resultContentId = `feed-result-${scriptKey}`;
    // A read-only workbook shows its cards greyed out
    const readOnly = useWorkbookReadOnly();
    const hasFooterContent = entryStatus.kind !== EntryStatusKind.Idle;
    return (
        <article
            className={styles.feed_entry_pair}
            data-read-only={readOnly ? '' : undefined}
            data-electron-drag-region="false"
            onPointerEnter={() => feed.focus(fileName)}
            aria-label={`${displayName} script cell`}
            data-testid="script-cell"
        >
            <div className={styles.feed_entry_cell} data-result-card={hasFooterContent ? '' : undefined}>
                <FeedEntryHeader
                    workbookId={model.workbookId}
                    scriptData={script}
                    scriptFileName={fileName}
                    connection={connection}
                    connectorType={connectorType}
                    queryState={query}
                    focused={display.focused}
                    canExecute={online}
                    scriptDebugMode={display.scriptDebugMode}
                    isFormattable={isFormattable}
                    canFormat={editorView != null}
                    scriptReferences={display.references}
                    canTarget={display.canTarget}
                    onTarget={() => feed.target(fileName)}
                    onExecute={() => { if (online) void model.run(); }}
                    onPickConnection={connectionId => feed.pickConnection(fileName, connectionId)}
                    onRename={name => feed.rename(fileName, name)}
                    onDelete={() => feed.delete(fileName)}
                    onFormat={handleFormat}
                    onApplySnippet={text => void model.setText(text)}
                    onSetVisSpec={spec => void model.setVisSpec(spec)}
                    storage={storage}
                    onAddAbove={() => feed.create(position.index)}
                    onAddBelow={() => feed.create(position.index + 1)}
                    onMoveUp={() => feed.moveUp(fileName)}
                    onMoveDown={() => feed.moveDown(fileName)}
                    canMoveUp={position.canMoveUp}
                    canMoveDown={position.canMoveDown}
                    dependencies={dependencies}
                />
                <div className={styles.feed_body}>
                    <div className={styles.feed_editor_container}>
                        {display.active && props.editor({
                            className: styles.feed_script_editor,
                            onFocus: () => feed.focus(fileName),
                            setView: handleEditorView,
                        })}
                        {hasPendingDiff && (
                            <div className={styles.feed_body_overlays}>
                                <div data-diff-actions>
                                    <ButtonGroup>
                                        <IconButton
                                            variant={ButtonVariant.Default}
                                            size={ButtonSize.Small}
                                            onClick={() => void model.acceptDiff()}
                                            aria-label="Accept rewrite"
                                            data-testid="diff-accept"
                                        >
                                            <CheckIcon size={14} />
                                        </IconButton>
                                        <IconButton
                                            variant={ButtonVariant.Default}
                                            size={ButtonSize.Small}
                                            onClick={() => void model.rejectDiff()}
                                            aria-label="Reject rewrite"
                                            data-testid="diff-reject"
                                        >
                                            <CrossIcon size={14} />
                                        </IconButton>
                                    </ButtonGroup>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                {hasFooterContent && (
                    <div className={styles.feed_entry_footer} data-feed-result="">
                        <EntryStatusBar
                            status={entryStatus}
                            onToggleExpanded={() => result.toggle(scriptKey)}
                            expanded={result.expanded}
                            controls={resultContentId}
                            onCancel={entryStatus.indicator === IndicatorStatus.Running ? cancel : undefined}
                            cancelLabel="Cancel query"
                            compact
                            tabs={<FeedEntryTabStrip tabs={resultTabs} expanded={result.expanded} onSelect={expandResult} />}
                            actions={
                                <>
                                    {cachedAtMs != null && <CachedResultBean cachedAtMs={cachedAtMs} />}
                                    <QueryResultRerunButton
                                        query={query}
                                        onRerun={online && !model.runActive ? () => void model.run({ refresh: true }) : undefined}
                                    />
                                </>
                            }
                        />
                        {query != null ? (
                            <div id={resultContentId} hidden={!result.expanded}>
                                {props.resultPanel({ selectedTab: resultTabs.selectedTab, onShowTable: showTable })}
                            </div>
                        ) : null}
                        {tableOpen && query != null && props.resultTable({ scriptName: displayName, onClose: closeTable })}
                    </div>
                )}
            </div>
        </article>
    );
});
