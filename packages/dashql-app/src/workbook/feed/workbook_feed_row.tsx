import * as React from 'react';
import * as styles from './workbook_feed.module.css';
import * as dashql from '@akohn/dashql';

import type { Icon } from '@akohn/dashql-react/components/symbol_icon';
import { PlusIcon } from '@akohn/dashql-react/components/symbol_icon';
import type { RowComponentProps } from 'react-window';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import type { StorageReader } from '../../storage/storage_provider.js';
import type { getScriptRefs } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { useScriptModel } from '@akohn/dashql-react/models/script_model';
import { useScriptReferences } from '@akohn/dashql-react/hooks';
import { ScriptEditor } from '../scripts/script_editor.js';
import type { EditorView } from '@codemirror/view';
import type { DashQLParameterClick } from '../editor/dashql_processor.js';
import type { ScriptConnectionView } from '../scripts/script_connection_picker.js';
import { ResultTableOverlay } from '../../results/result_table_overlay.js';
import { FeedEntryFooter } from './feed_entry_footer.js';
import {
    ScriptCard, type ScriptCardDisplay, type ScriptCardPosition, type ScriptEditorSlot, type ScriptFeedCommands,
    type ScriptResultFold, type ScriptResultSlot, type ScriptResultTableSlot,
} from './script_card.js';
import { useWorkbookReadOnly } from '../workbook_read_only.js';
import { useIsScriptSelected } from '../scripts/script_selection.js';
import { feedTopSpace } from './workbook_feed_layout.js';

// A row of the feed: the card of a script with the buttons around it. The row connects the card: it resolves the model
// of the script (`useScriptModel`) and renders the parts of the card that read the runtime, the editor and the result.

const DragHandleIcon: Icon = SymbolIcon('drag_handle_16');

export interface ScriptFeedRowProps {
    workbookId: string;
    /// The connections that the scripts run on
    connections: ReadonlyMap<string, ScriptConnectionView>;
    storageReader: StorageReader;
    entries: ReturnType<typeof getScriptRefs>;
    scriptDebugMode: boolean;
    formattingDebugMode: boolean;
    keywordCase: dashql.buffers.formatting.KeywordCase;
    active: boolean;
    /// The folded results by script key, see `ScriptResultFold`
    collapsedResults: ReadonlyMap<number, number | null>;
    /// Fold the results, the rest of `ScriptResultFold`
    fold: Omit<ScriptResultFold, 'expanded'>;
    /// The commands of the feed
    feed: ScriptFeedCommands;
    /// A click on a named parameter in the editor of a script
    onParameterClick: (scriptKey: number, click: DashQLParameterClick, view: EditorView) => void;
    /// The height of the inputs above the first script, the first row leaves it free
    topInset: number;
    dependencies?: ScriptFeedRowDependencies;
}

export interface ScriptFeedRowDependencies {
    useScriptModel: typeof useScriptModel;
    useSortable: typeof useSortable;
    translateTransform: typeof CSS.Translate.toString;
    ScriptCard: typeof ScriptCard;
}

const DEFAULT_SCRIPT_FEED_ROW_DEPENDENCIES: ScriptFeedRowDependencies = {
    useScriptModel,
    useSortable,
    translateTransform: CSS.Translate.toString,
    ScriptCard,
};

export function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
    const dependencies = props.dependencies ?? DEFAULT_SCRIPT_FEED_ROW_DEPENDENCIES;
    const entryIndex = props.index;
    const entry = props.entries[entryIndex];
    const model = dependencies.useScriptModel(props.workbookId, entry?.scriptId ?? null);
    const scriptKey = model?.script.scriptKey ?? null;
    const scriptFileName = entry?.fileName ?? 'script.sql';
    const displayName = scriptDisplayName(scriptFileName);
    // Every script runs on its own connection
    const connection = model != null ? props.connections.get(model.script.connectionId) ?? null : null;

    // A read-only workbook adds and moves no scripts
    const readOnly = useWorkbookReadOnly();

    // Entries are in feed order, so the index drives the movement buttons
    const canMoveUp = entryIndex > 0;
    const canMoveDown = entryIndex < props.entries.length - 1;
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = dependencies.useSortable({
        id: entry?.scriptId ?? `missing-${entryIndex}`,
        disabled: readOnly,
        // The optimistic order is already the final dropped layout. Suppress dnd-kit's derived
        // post-drop FLIP transform, which otherwise briefly animates the card back toward its old row.
        animateLayoutChanges: () => false,
    });
    // What the card shows, the identity of each part stays while it is unchanged: the card is memoized
    const position = React.useMemo<ScriptCardPosition>(() => ({ index: entryIndex, canMoveUp, canMoveDown }), [entryIndex, canMoveUp, canMoveDown]);
    // The references of the script, the reports of the other scripts leave the row alone
    const references = useScriptReferences(props.workbookId, scriptKey);
    // The selection of another script leaves the row alone
    const focused = useIsScriptSelected(props.workbookId, scriptKey);
    const display = React.useMemo<ScriptCardDisplay>(() => ({
        focused,
        active: props.active,
        // A script of the feed mentions itself in the composer
        canTarget: true,
        scriptDebugMode: props.scriptDebugMode,
        formattingDebugMode: props.formattingDebugMode,
        keywordCase: props.keywordCase,
        references,
    }), [focused, props.active, props.scriptDebugMode, props.formattingDebugMode, props.keywordCase, references]);
    const expanded = scriptKey == null || !props.collapsedResults.has(scriptKey);
    const result = React.useMemo<ScriptResultFold>(() => ({ ...props.fold, expanded }), [props.fold, expanded]);
    // The parts of the card that read the runtime
    const query = model?.query ?? null;
    const visualizeQuery = model?.script.annotations.visualizeQuery ?? null;
    const { onParameterClick } = props;
    const handleParameterClick = React.useCallback((click: DashQLParameterClick, view: EditorView) => {
        if (scriptKey != null) onParameterClick(scriptKey, click, view);
    }, [scriptKey, onParameterClick]);
    const editor = React.useCallback((slot: ScriptEditorSlot) => scriptKey == null ? null : (
        <ScriptEditor
            workbookId={props.workbookId}
            scriptKey={scriptKey}
            className={slot.className}
            autoHeight
            lineWrapping
            onFocus={slot.onFocus}
            setView={slot.setView}
            onParameterClick={handleParameterClick}
        />
    ), [props.workbookId, scriptKey, handleParameterClick]);
    const resultPanel = React.useCallback((slot: ScriptResultSlot) => query == null ? null : (
        <FeedEntryFooter
            workbookId={props.workbookId}
            model={query}
            visualizeQuery={visualizeQuery}
            selectedTab={slot.selectedTab}
            onShowTable={slot.onShowTable}
            moreRows={slot.moreRows}
            onShowMoreRows={slot.onShowMoreRows}
            onShowFewerRows={slot.onShowFewerRows}
        />
    ), [props.workbookId, query, visualizeQuery]);
    const resultTable = React.useCallback((slot: ScriptResultTableSlot) => query == null ? null : (
        <ResultTableOverlay scriptName={slot.scriptName} model={query} onClose={slot.onClose} />
    ), [query]);

    // The row holds the card and the space below it, the first row also the space above the feed.
    // The add buttons sit in these spaces, a button between two scripts shows while either one is hovered.
    // The feed measures the card, the first child of the row (`useWorkbookFeedLayout`).
    return (
        <div
            className={styles.feed_row}
            style={{ ...props.style, paddingTop: props.index === 0 ? feedTopSpace(props.topInset) : undefined }}
            data-testid="script-feed-row"
        >
            <div
                ref={setNodeRef}
                className={styles.feed_list_item}
                data-testid="script-feed-item"
                data-script-key={entry?.scriptId}
                style={{
                    // dnd-kit may scale the active item toward a differently sized target row.
                    // Feed cards have variable heights, so scaling visibly squashes or stretches them.
                    transform: dependencies.translateTransform(transform),
                    transition,
                    zIndex: isDragging ? 1 : undefined,
                }}
            >
                {!readOnly && <><button
                    type="button"
                    className={styles.feed_entry_insert}
                    data-edge="above"
                    aria-label={`Add script above ${displayName}`}
                    data-testid="script-insert-above"
                    onClick={() => props.feed.create(entryIndex)}
                >
                    <PlusIcon size={14} />
                </button>
                <button
                    type="button"
                    className={styles.feed_entry_drag_handle}
                    aria-label={`Drag ${displayName} script to reorder`}
                    data-testid="script-drag-handle"
                    {...attributes}
                    {...listeners}
                >
                    <DragHandleIcon size={16} />
                </button></>}
                {model != null && <dependencies.ScriptCard
                    key={entry?.scriptId}
                    model={model}
                    connection={connection}
                    position={position}
                    display={display}
                    result={result}
                    feed={props.feed}
                    storageReader={props.storageReader}
                    editor={editor}
                    resultPanel={resultPanel}
                    resultTable={resultTable}
                />}
                {!readOnly && <button
                    type="button"
                    className={styles.feed_entry_insert}
                    data-edge="below"
                    data-shared={entryIndex < props.entries.length - 1 ? '' : undefined}
                    aria-label={`Add script below ${displayName}`}
                    data-testid="script-insert-below"
                    onClick={() => props.feed.create(entryIndex + 1)}
                >
                    <PlusIcon size={14} />
                </button>}
            </div>
        </div>
    );
}
