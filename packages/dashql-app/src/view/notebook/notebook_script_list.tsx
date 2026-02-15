import * as React from 'react';
import * as styles from './notebook_page.module.css';

import type { Icon } from '@primer/octicons-react';

import { ButtonVariant, IconButton } from '../foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { getSelectedPageEntries, type ScriptData, NotebookState, SELECT_ENTRY } from '../../notebook/notebook_state.js';
import { buildScriptSummary, type ScriptSummary, type ColumnFilterSummary } from '../../notebook/script_summary.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';

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
                    <span className={styles.script_summary_label}>Filters</span>
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

interface CollapsedScriptCardProps {
    entryIndex: number;
    scriptData: ScriptData | undefined;
    onExpand: (entryIndex: number) => void;
}

const CollapsedScriptCard: React.FC<CollapsedScriptCardProps> = ({ entryIndex, scriptData, onExpand }) => {
    const ScreenFullIcon: Icon = SymbolIcon('screen_full_16');
    const summary = React.useMemo(
        () => scriptData ? buildScriptSummary(scriptData.processed, scriptData.script?.toString() ?? null) : null,
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

export const NotebookScriptList: React.FC<NotebookScriptListProps> = (props) => {
    const entries = getSelectedPageEntries(props.notebook);

    const handleExpand = React.useCallback((entryIndex: number) => {
        props.modifyNotebook({ type: SELECT_ENTRY, value: entryIndex });
        props.showDetails();
    }, [props.modifyNotebook, props.showDetails]);

    return (
        <div className={styles.collection_body_container}>
            <div className={styles.collection_entry_list}>
                {entries.map((entry, wi) => (
                    <CollapsedScriptCard
                        key={wi}
                        entryIndex={wi}
                        scriptData={props.notebook.scripts[entry.scriptId]}
                        onExpand={handleExpand}
                    />
                ))}
            </div>
        </div>
    );
};
