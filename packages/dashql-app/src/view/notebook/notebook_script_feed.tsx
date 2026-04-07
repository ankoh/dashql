import * as React from 'react';
import * as styles from './notebook_script_feed.module.css';

import type { Icon } from '@primer/octicons-react';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';

import { Button, ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { getSelectedPageEntries, getUncommittedScriptData, type ScriptData, NotebookState, SELECT_ENTRY, PROMOTE_UNCOMMITTED_SCRIPT, DELETE_NOTEBOOK_ENTRY } from '../../notebook/notebook_state.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { ScriptEditor } from './script_editor.js';
import { ScriptPreview } from './notebook_script_preview.js';
import { observeSize } from '../foundations/size_observer.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { useScrollbarWidth } from '../../utils/scrollbar.js';

export interface NotebookScriptListProps {
    notebook: NotebookState;
    modifyNotebook: ModifyNotebook;
    showDetails: () => void;
}

const ESTIMATED_ROW_HEIGHT = 120;
const FEED_EDGE_PADDING = 8;
const FEED_BOTTOM_FADE_HEIGHT = 24;

interface CollapsedScriptCardProps {
    entryIndex: number;
    scriptData: ScriptData | undefined;
    onExpand: (entryIndex: number) => void;
    onDelete: (entryIndex: number) => void;
}

const ScriptCard: React.FC<CollapsedScriptCardProps> = ({ entryIndex, scriptData, onExpand, onDelete }) => {
    const TrashIcon: Icon = SymbolIcon('trash_16');
    const handlePreviewPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || event.defaultPrevented) {
            return;
        }
        onExpand(entryIndex);
    }, [entryIndex, onExpand]);

    return (
        <div className={styles.feed_entry_card}>
            <div className={styles.feed_body} onPointerDownCapture={handlePreviewPointerDown}>
                {scriptData != null ? <ScriptPreview className={styles.script_preview_editor} scriptData={scriptData} /> : null}
            </div>
            <div className={styles.feed_entry_footer}>
                <IconButton
                    className={styles.feed_entry_status_indicator_button}
                    variant={ButtonVariant.Invisible}
                    aria-label="expand"
                    aria-labelledby="expand-entry"
                >
                    <StatusIndicator
                        className={styles.feed_entry_status_indicator_button}
                        fill="black"
                        width={"14px"}
                        height={"14px"}
                        status={IndicatorStatus.Succeeded}
                    />
                </IconButton>
                <IconButton
                    className={styles.feed_entry_delete_button}
                    variant={ButtonVariant.Invisible}
                    onClick={() => onDelete(entryIndex)}
                    aria-label="delete"
                    aria-labelledby="delete-entry"
                >
                    <TrashIcon size={16} />
                </IconButton>
            </div>
        </div>
    );
};

interface ScriptFeedRowProps {
    entries: ReturnType<typeof getSelectedPageEntries>;
    scripts: NotebookState['scripts'];
    onExpand: (index: number) => void;
    onDelete: (index: number) => void;
    onHeightMeasured: (index: number, height: number) => void;
    fillerRowHeight: number;
    heightsVersion: number;
}

function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
    const { entries, scripts, onExpand, onDelete, onHeightMeasured } = props;
    const isFillerRow = props.index === 0 || props.index > entries.length;
    const entryIndex = props.index - 1;
    const entry = !isFillerRow ? entries[entryIndex] : undefined;
    const scriptData = entry != null ? scripts[entry.scriptId] : undefined;

    const outerRef = React.useRef<HTMLDivElement>(null);

    React.useLayoutEffect(() => {
        if (isFillerRow) {
            return;
        }
        const el = outerRef.current;
        if (!el) return;
        const measure = () => {
            const h = el.getBoundingClientRect().height;
            if (h > 0) onHeightMeasured(entryIndex, h);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [entryIndex, isFillerRow, onHeightMeasured]);

    if (isFillerRow) {
        return <div className={styles.feed_list_filler} style={props.style} />;
    }

    return (
        <div ref={outerRef} style={{ ...props.style, height: 'auto' }}>
            <div className={styles.feed_list_item}>
                <ScriptCard
                    entryIndex={entryIndex}
                    scriptData={scriptData}
                    onExpand={onExpand}
                    onDelete={onDelete}
                />
            </div>
        </div>
    );
}

export const NotebookScriptFeed: React.FC<NotebookScriptListProps> = (props) => {
    const entries = getSelectedPageEntries(props.notebook);
    const scrollbarWidth = useScrollbarWidth();

    const handleExpand = React.useCallback((entryIndex: number) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: entryIndex });
        props.showDetails();
    }, [props.modifyNotebook, props.showDetails]);

    const handleSend = React.useCallback(() => {
        props.modifyNotebook({ type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
    }, [props.modifyNotebook]);

    const handleDelete = React.useCallback((entryIndex: number) => {
        props.modifyNotebook({ type: DELETE_NOTEBOOK_ENTRY, value: entryIndex });
    }, [props.modifyNotebook]);

    // Height cache for variable-height rows
    const heightsRef = React.useRef<number[]>([]);
    const [heightsVersion, setHeightsVersion] = React.useState(0);

    const handleHeightMeasured = React.useCallback((index: number, height: number) => {
        if (heightsRef.current[index] !== height) {
            heightsRef.current[index] = height;
            setHeightsVersion(v => v + 1);
        }
    }, []);

    const getRowHeight = React.useCallback((row: number) => {
        return heightsRef.current[row] ?? ESTIMATED_ROW_HEIGHT;
    }, []);

    // Measure list container dimensions for react-window
    const listContainerRef = React.useRef<HTMLDivElement>(null);
    const listContainerSize = observeSize(listContainerRef);
    const listWidth = listContainerSize?.width ?? 0;
    const listHeight = listContainerSize?.height ?? 0;
    const listRef = useListRef(null);

    // Track the height of the composer for the filler row
    const composeSectionRef = React.useRef<HTMLDivElement>(null);
    const composeSectionSize = observeSize(composeSectionRef);
    const composePadding = 24;
    const composeSectionHeight = (composeSectionSize?.height ?? 0) + composePadding;
    const fillerRowHeight = composeSectionHeight + FEED_BOTTOM_FADE_HEIGHT;
    const estimatedFeedContentHeight =
        FEED_EDGE_PADDING +
        entries.reduce((total, _entry, index) => total + getRowHeight(index), 0) +
        fillerRowHeight +
        FEED_EDGE_PADDING;
    const composeScrollbarInset =
        listHeight > 0 && estimatedFeedContentHeight > listHeight
            ? scrollbarWidth
            : 0;

    // Row props — heightsVersion is included so react-window re-evaluates row heights on change
    const rowProps = React.useMemo<ScriptFeedRowProps>(() => ({
        entries,
        scripts: props.notebook.scripts,
        onExpand: handleExpand,
        onDelete: handleDelete,
        onHeightMeasured: handleHeightMeasured,
        fillerRowHeight,
        heightsVersion,
    }), [entries, props.notebook.scripts, handleExpand, handleDelete, handleHeightMeasured, fillerRowHeight, heightsVersion]);

    return (
        <div className={styles.feed_body_container}>
            <div className={styles.feed_list_container} ref={listContainerRef}>
                <List
                    listRef={listRef}
                    style={{ width: listWidth, height: listHeight }}
                    rowCount={entries.length + 2}
                    rowHeight={(rowIndex) => {
                        if (rowIndex === 0) {
                            return FEED_EDGE_PADDING;
                        }
                        if (rowIndex <= entries.length) {
                            return getRowHeight(rowIndex - 1);
                        }
                        return fillerRowHeight + FEED_EDGE_PADDING;
                    }}
                    rowComponent={ScriptFeedRow}
                    rowProps={rowProps}
                />
            </div>
            <div className={styles.compose_section} ref={composeSectionRef} style={{ right: composeScrollbarInset }}>
                <div className={styles.compose_card}>
                    <ScriptEditor
                        notebookId={props.notebook.notebookId}
                        scriptKey={getUncommittedScriptData(props.notebook)?.scriptKey ?? 0}
                        className={styles.compose_card_body}
                        autoHeight
                    />
                    <div className={styles.compose_action_bar}>
                        <Button
                            size={ButtonSize.Small}
                            onClick={handleSend}
                        >
                            Send
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
