import * as React from 'react';
import * as styles from './workbook_feed.module.css';

import type { EditorView } from '@codemirror/view';
import type { Icon } from '@akohn/dashql-react/components/symbol_icon';

import { Button, ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { ButtonGroup } from '@akohn/dashql-react/components/button_group';
import { IndicatorStatus } from '@akohn/dashql-react/components/status_indicator';
import { SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import type { StorageReader } from '../../storage/storage_provider.js';
import type { ScriptModel } from '@akohn/dashql-react/models/script_model';
import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import { deriveEntryStatus, EntryStatusKind } from '../entry_status_model.js';
import { EntryStatusBar } from '../entry_status_bar.js';
import { QueryResultRerunButton, StoredResultBean } from '../persistence/stored_result_controls.js';
import {
    DEFAULT_FEED_ENTRY_HEADER_DEPENDENCIES, FeedEntryHeader, type FeedEntryHeaderDependencies, type FeedEntryHeaderDisplay,
} from './feed_entry_header.js';
import { FeedEntryTab, FeedEntryTabStrip, useFeedEntryTabs } from './feed_entry_footer.js';
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
export interface ScriptCardDisplay extends FeedEntryHeaderDisplay {
    /// Is the feed shown? A hidden feed mounts no editors.
    active: boolean;
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
    /// Open the chart over the feed
    onShowChart: () => void;
    /// The table shows more rows in the card, with a scroller and the column plots
    moreRows: boolean;
    /// Show more rows of the table in the card, until the user shows fewer, picks a tab, folds the result or runs again
    onShowMoreRows: () => void;
    /// Show only the first rows of the table again
    onShowFewerRows: () => void;
}

/// The slot of the full result over the feed: the table, or the chart in the size of the window
export interface ScriptResultTableSlot {
    scriptName: string;
    kind: 'table' | 'chart';
    onClose: () => void;
}

/// The parts of the card that need a real script session or editor, a test may replace them. None reads the runtime.
export type ScriptCardDependencies = FeedEntryHeaderDependencies;

export const DEFAULT_SCRIPT_CARD_DEPENDENCIES: ScriptCardDependencies = DEFAULT_FEED_ENTRY_HEADER_DEPENDENCIES;

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
const RunIcon: Icon = SymbolIcon('paper_airplane_16');
const CrossIcon: Icon = SymbolIcon('x_16');

// Memoized, the row renders again with its script and the card with the parts of the script that it shows
/// The lines of SQL that a folded script shows on a compact window
const FOLDED_SQL_LINES = 4;

export const ScriptCard: React.FC<ScriptCardProps> = React.memo((props: ScriptCardProps) => {
    const { model, connection, position, display, result, feed } = props;
    const dependencies = props.dependencies ?? DEFAULT_SCRIPT_CARD_DEPENDENCIES;
    const script = model.script;
    const scriptKey = script.scriptKey;
    const fileName = script.fileName;
    const query = model.query?.query ?? null;
    const online = connection?.connectionHealth === ConnectionHealth.ONLINE;

    // A staged rewrite waiting to be accepted or rejected. The editor shows the diff in place, these buttons are the
    // explicit alternatives.
    const hasPendingDiff = script.pendingDiff != null;
    // A card with a result shows it below the editor
    const resultCard = deriveEntryStatus(query, query?.progress ?? null).kind !== EntryStatusKind.Idle;

    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    // A compact window folds a script of more lines than FOLDED_SQL_LINES to its first lines, the result shows right
    // below them; a focus in the editor or the button unfolds it (docs/design/narrow_layouts.md). Wider windows ignore
    // the fold.
    const [sqlUnfolded, setSqlUnfolded] = React.useState(false);
    const sqlFoldable = (editorView?.state.doc.lines ?? 0) > FOLDED_SQL_LINES;
    const handleEditorView = React.useCallback((view: EditorView) => {
        setEditorView(view);
        feed.editorView(scriptKey, view);
    }, [feed, scriptKey]);
    // The connection picker of the header is memoized, its command keeps its identity with the script
    const pickConnection = React.useCallback((connectionId: string) => feed.pickConnection(fileName, connectionId), [feed, fileName]);

    // Labels use the display name (the file name without ".sql"), the file name stays the identity of the commands
    const displayName = scriptDisplayName(fileName);
    // A read-only workbook shows its cards greyed out
    const readOnly = useWorkbookReadOnly();
    return (
        <article
            className={styles.feed_entry_pair}
            data-read-only={readOnly ? '' : undefined}
            data-electron-drag-region="false"
            onPointerEnter={() => feed.focus(fileName)}
            aria-label={`${displayName} script cell`}
            data-testid="script-cell"
        >
            <div className={styles.feed_entry_cell} data-result-card={resultCard ? '' : undefined}>
                <FeedEntryHeader
                    model={model}
                    connection={connection}
                    display={display}
                    editorView={editorView}
                    storageReader={props.storageReader}
                    onTarget={() => feed.target(fileName)}
                    onPickConnection={pickConnection}
                    onRename={name => feed.rename(fileName, name)}
                    onDelete={() => feed.delete(fileName)}
                    onAddAbove={() => feed.create(position.index)}
                    onAddBelow={() => feed.create(position.index + 1)}
                    onMoveUp={() => feed.moveUp(fileName)}
                    onMoveDown={() => feed.moveDown(fileName)}
                    canMoveUp={position.canMoveUp}
                    canMoveDown={position.canMoveDown}
                    dependencies={dependencies}
                />
                <div className={styles.feed_body}>
                    <div className={styles.feed_editor_container} data-sql-fold={!sqlFoldable ? undefined : sqlUnfolded ? 'unfolded' : 'folded'}>
                        {display.active && props.editor({
                            className: styles.feed_script_editor,
                            onFocus: () => {
                                setSqlUnfolded(true);
                                feed.focus(fileName);
                            },
                            setView: handleEditorView,
                        })}
                        {sqlFoldable && (
                            <button type="button" className={styles.feed_sql_fold} data-testid="script-sql-fold"
                                aria-expanded={sqlUnfolded} onClick={() => setSqlUnfolded(unfolded => !unfolded)}>
                                {sqlUnfolded ? 'Fold SQL' : `Show SQL, ${editorView?.state.doc.lines ?? 0} lines`}
                            </button>
                        )}
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
                <ScriptCardResult
                    scriptKey={scriptKey}
                    scriptName={displayName}
                    query={model.query}
                    visualizeQuery={script.annotations.visualizeQuery ?? null}
                    latestQueryId={script.latestQueryId ?? null}
                    storedResult={script.storedResult ?? null}
                    online={online}
                    runActive={model.runActive}
                    run={model.run}
                    cancel={model.cancel}
                    result={result}
                    resultPanel={props.resultPanel}
                    resultTable={props.resultTable}
                />
            </div>
        </article>
    );
});

/// The result of a card: the status bar of the latest query with its tabs, and the panel of the selected tab
interface ScriptCardResultProps {
    scriptKey: number;
    /// The display name of the script
    scriptName: string;
    /// The latest query of the script, null before its first run
    query: QueryModel | null;
    visualizeQuery: ScriptModel['script']['annotations']['visualizeQuery'];
    latestQueryId: number | null;
    /// The stored result of the script in the results of the workbook, null without one
    storedResult: ScriptModel['script']['storedResult'];
    /// Is the connection of the script online?
    online: boolean;
    runActive: boolean;
    run: ScriptModel['run'];
    cancel: ScriptModel['cancel'];
    result: ScriptResultFold;
    resultPanel: (slot: ScriptResultSlot) => React.ReactNode;
    resultTable: (slot: ScriptResultTableSlot) => React.ReactNode;
}

// Memoized, a keystroke changes the script and leaves its result alone: the props are the parts of the model that the
// result shows and the operations of the model, which keep their identity
const ScriptCardResult = React.memo(function ScriptCardResult(props: ScriptCardResultProps) {
    const { scriptKey, result, run, cancel, online } = props;
    const query = props.query?.query ?? null;
    const entryStatus = deriveEntryStatus(query, query?.progress ?? null);
    // The result tabs live in the status bar, their panel below it
    const resultTabs = useFeedEntryTabs(props.query, props.visualizeQuery);
    const { autoCollapse, resetAutoCollapsed } = result;
    const { latestQueryId } = props;
    React.useEffect(() => {
        if (query?.status !== QueryExecutionStatus.SUCCEEDED || query.resultTable !== null) {
            resetAutoCollapsed(scriptKey, query?.queryId ?? latestQueryId);
            return;
        }
        autoCollapse(scriptKey, query.queryId);
    }, [autoCollapse, resetAutoCollapsed, latestQueryId, query, scriptKey]);
    // The full result table or the chart opens in a card over the feed
    const [overlay, setOverlay] = React.useState<'table' | 'chart' | null>(null);
    const showTable = React.useCallback(() => setOverlay('table'), []);
    const showChart = React.useCallback(() => setOverlay('chart'), []);
    const closeOverlay = React.useCallback(() => setOverlay(null), []);

    // More rows of the table grow the card in place: the card shows them for the query that the user expanded and only
    // on its table tab, and shows the first rows again with the row under the rows, a tab or the fold of the result
    const queryId = query?.queryId ?? null;
    const [moreRowsQueryId, setMoreRowsQueryId] = React.useState<number | null>(null);
    const moreRows = queryId != null && moreRowsQueryId === queryId && result.expanded
        && resultTabs.selectedTab === FeedEntryTab.Table;
    const showMoreRows = React.useCallback(() => setMoreRowsQueryId(queryId), [queryId]);
    const showFewerRows = React.useCallback(() => setMoreRowsQueryId(null), []);

    const resultContentId = `feed-result-${scriptKey}`;
    const readOnly = useWorkbookReadOnly();
    const storedResult = props.storedResult;
    const runScript = () => { if (online) void run(); };
    // A script that did not run yet shows where its result will be, a read-only workbook only says so
    if (entryStatus.kind === EntryStatusKind.Idle) {
        return (
            <div className={styles.feed_entry_footer}>
                <EntryStatusBar
                    status={entryStatus}
                    // Nothing below the bar, it keeps no line at its bottom
                    expanded={false}
                    compact
                    actions={
                        <>
                            {storedResult != null && <StoredResultBean writtenAtMs={storedResult.writtenAt} current={storedResult.current} />}
                            {!readOnly && (
                                <Button
                                    variant={ButtonVariant.Invisible}
                                    size={ButtonSize.Small}
                                    leadingVisual={<RunIcon size={12} />}
                                    onClick={runScript}
                                    disabled={!online || props.runActive}
                                    aria-label={`Run ${props.scriptName}`}
                                    data-testid="feed-idle-run"
                                >
                                    Run
                                </Button>
                            )}
                        </>
                    }
                />
            </div>
        );
    }
    return (
        <div className={styles.feed_entry_footer} data-feed-result="">
            <EntryStatusBar
                status={entryStatus}
                onToggleExpanded={() => {
                    showFewerRows();
                    result.toggle(scriptKey);
                }}
                expanded={result.expanded}
                controls={resultContentId}
                onCancel={entryStatus.indicator === IndicatorStatus.Running ? () => {
                    if (entryStatus.kind === EntryStatusKind.Query) void cancel();
                } : undefined}
                cancelLabel="Cancel query"
                compact
                tabs={<FeedEntryTabStrip tabs={resultTabs} expanded={result.expanded} onSelect={() => {
                    showFewerRows();
                    // Picking a tab of a folded result shows it
                    if (!result.expanded) result.toggle(scriptKey);
                }} />}
                actions={
                    <>
                        {storedResult != null && <StoredResultBean writtenAtMs={storedResult.writtenAt} current={storedResult.current} />}
                        <QueryResultRerunButton
                            query={query}
                            onRerun={online && !props.runActive ? () => void run({ refresh: true }) : undefined}
                        />
                    </>
                }
            />
            {query != null ? (
                <div id={resultContentId} hidden={!result.expanded}>
                    {props.resultPanel({
                        selectedTab: resultTabs.selectedTab,
                        onShowTable: showTable,
                        onShowChart: showChart,
                        moreRows,
                        onShowMoreRows: showMoreRows,
                        onShowFewerRows: showFewerRows,
                    })}
                </div>
            ) : null}
            {overlay != null && query != null && props.resultTable({ scriptName: props.scriptName, kind: overlay, onClose: closeOverlay })}
        </div>
    );
});
