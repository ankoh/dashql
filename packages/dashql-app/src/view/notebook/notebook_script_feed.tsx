import * as React from 'react';
import * as styles from './notebook_script_feed.module.css';

import type { Icon } from '@primer/octicons-react';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';

import { Button, ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { getSelectedPageEntries, getUncommittedScriptData, type ScriptData, NotebookState, SELECT_ENTRY, PROMOTE_UNCOMMITTED_SCRIPT } from '../../notebook/notebook_state.js';
import { buildScriptSummary, type ScriptSummary, type ColumnFilterSummary } from '../../notebook/script_summary.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { ScriptEditor } from './script_editor.js';
import { observeSize } from '../foundations/size_observer.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';

export interface NotebookScriptListProps {
    notebook: NotebookState;
    modifyNotebook: ModifyNotebook;
    showDetails: () => void;
}

function SummaryRow({ label, items }: { label: string; items: string[] }) {
    if (items.length === 0) return null;
    return (
        <div className={styles.script_summary_row}>
            <span className={styles.script_summary_label}>{label}</span>
            <div className={styles.script_summary_tags}>
                {items.map((s, i) => (
                    <span key={i} className={styles.script_summary_tag}>{s}</span>
                ))}
            </div>
        </div>
    );
}

function FilterWithBean({ filter }: { filter: ColumnFilterSummary }) {
    const { filterText, columnRefStart, columnRefLength } = filter;
    const before = filterText.slice(0, columnRefStart);
    const bean = filterText.slice(columnRefStart, columnRefStart + columnRefLength);
    const after = filterText.slice(columnRefStart + columnRefLength);
    return (
        <span className={styles.script_summary_tag}>
            {before}
            <span className={styles.script_summary_filter_bean}>{bean}</span>
            {after}
        </span>
    );
}

function ScriptSummarySection({ summary }: { summary: ScriptSummary }) {
    const hasAny = summary.tableRefs.length > 0 || summary.columnRefs.length > 0
        || summary.tableDefs.length > 0 || summary.columnFilters.length > 0 || summary.functionRefs.length > 0;
    if (!hasAny) {
        return <div className={styles.script_summary_empty}>No analysis yet</div>;
    }
    return (
        <div className={styles.script_summary}>
            <SummaryRow label="Table References" items={summary.tableRefs} />
            <SummaryRow label="Column References" items={summary.columnRefs} />
            <SummaryRow label="Table Definitions" items={summary.tableDefs} />
            <SummaryRow label="Function References" items={summary.functionRefs} />
            {summary.columnFilters.length > 0 && (
                <div className={styles.script_summary_row}>
                    <span className={styles.script_summary_label}>Column Filters</span>
                    <div className={styles.script_summary_tags}>
                        {summary.columnFilters.map((f, i) => (
                            <FilterWithBean key={i} filter={f} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

const ESTIMATED_ROW_HEIGHT = 120;

interface CollapsedScriptCardProps {
    entryIndex: number;
    scriptData: ScriptData | undefined;
    onExpand: (entryIndex: number) => void;
}

const ScriptCard: React.FC<CollapsedScriptCardProps> = ({ entryIndex, scriptData, onExpand }) => {
    const ScreenFullIcon: Icon = SymbolIcon('screen_full_16');
    const summary = React.useMemo(
        () => scriptData ? buildScriptSummary(scriptData.scriptAnalysis, scriptData.script?.toString() ?? null) : null,
        [scriptData],
    );
    return (
        <div className={styles.collection_entry_card}>
            <div className={styles.collection_entry_header}>
                <IconButton
                    className={styles.entry_status_indicator_button}
                    variant={ButtonVariant.Invisible}
                    aria-label="expand"
                    aria-labelledby="expand-entry"
                >
                    <StatusIndicator
                        className={styles.collection_entry_status_indicator_button}
                        fill="black"
                        width={"14px"}
                        height={"14px"}
                        status={IndicatorStatus.Succeeded}
                    />
                </IconButton>
                <IconButton
                    className={styles.collection_entry_expand_button}
                    variant={ButtonVariant.Invisible}
                    onClick={() => onExpand(entryIndex)}
                    aria-label="expand"
                    aria-labelledby="expand-entry"
                >
                    <ScreenFullIcon size={16} />
                </IconButton>
            </div>
            <div className={styles.collection_body}>
                {summary != null ? <ScriptSummarySection summary={summary} /> : null}
            </div>
        </div>
    );
};

interface ScriptFeedRowProps {
    entries: ReturnType<typeof getSelectedPageEntries>;
    scripts: NotebookState['scripts'];
    onExpand: (index: number) => void;
    onHeightMeasured: (index: number, height: number) => void;
    heightsVersion: number;
}

function ScriptFeedRow(props: RowComponentProps<ScriptFeedRowProps>) {
    const { entries, scripts, onExpand, onHeightMeasured } = props;
    const entry = entries[props.index];
    const scriptData = entry != null ? scripts[entry.scriptId] : undefined;

    const outerRef = React.useRef<HTMLDivElement>(null);

    React.useLayoutEffect(() => {
        const el = outerRef.current;
        if (!el) return;
        const measure = () => {
            const h = el.getBoundingClientRect().height;
            if (h > 0) onHeightMeasured(props.index, h);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [props.index, onHeightMeasured]);

    return (
        <div ref={outerRef} style={{ ...props.style, height: 'auto' }}>
            <div className={styles.collection_list_item}>
                <ScriptCard
                    entryIndex={props.index}
                    scriptData={scriptData}
                    onExpand={onExpand}
                />
            </div>
        </div>
    );
}

export const NotebookScriptFeed: React.FC<NotebookScriptListProps> = (props) => {
    const entries = getSelectedPageEntries(props.notebook);

    const handleExpand = React.useCallback((entryIndex: number) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: entryIndex });
        props.showDetails();
    }, [props.modifyNotebook, props.showDetails]);

    const handleSend = React.useCallback(() => {
        props.modifyNotebook({ type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
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

    // Row props — heightsVersion is included so react-window re-evaluates row heights on change
    const rowProps = React.useMemo<ScriptFeedRowProps>(() => ({
        entries,
        scripts: props.notebook.scripts,
        onExpand: handleExpand,
        onHeightMeasured: handleHeightMeasured,
        heightsVersion,
    }), [entries, props.notebook.scripts, handleExpand, handleHeightMeasured, heightsVersion]);

    return (
        <div className={styles.collection_body_container}>
            <div className={styles.collection_list_section} ref={listContainerRef}>
                <List
                    listRef={listRef}
                    style={{ width: listWidth, height: listHeight }}
                    rowCount={entries.length}
                    rowHeight={getRowHeight}
                    rowComponent={ScriptFeedRow}
                    rowProps={rowProps}
                />
            </div>
            <div className={styles.compose_section}>
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
