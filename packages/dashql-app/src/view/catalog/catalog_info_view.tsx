import * as React from "react";
import * as styles from "./catalog_info_view.module.css";

import { motion } from 'framer-motion';

import { ConnectionState } from "../../connection/connection_state.js";
import { formatTimeDifference } from "../../utils/format.js";
import { SymbolIcon } from "../../view/foundations/symbol_icon.js";
import { ButtonVariant, IconButton } from "../../view/foundations/button.js";

interface CatalogInfoViewProps {
    conn: ConnectionState;
    entries: [string, string][];
    alwaysExpand: boolean;
}

interface CatalogStats {
    dbCount: number;
    schemaCount: number;
    tableCount: number;
    columnCount: number;
}

const UI_REFRESH_INTERVAL = 5000;

export function CatalogInfoView(props: CatalogInfoViewProps) {
    const snap = props.conn.catalog.createSnapshot();

    const catalogStats = React.useMemo(() => {
        const snapReader = snap.read();

        const dbCount = snapReader.catalogReader.databasesLength();
        const schemaCount = snapReader.catalogReader.schemasLength();
        const tableCount = snapReader.catalogReader.tablesLength();
        const columnCount = snapReader.catalogReader.columnsLength();
        const stats: CatalogStats = {
            dbCount,
            schemaCount,
            tableCount,
            columnCount
        };

        return stats;

    }, [snap]);

    const [refreshUi, setRefreshUi] = React.useState<number>(1);
    React.useEffect(() => {
        const timeoutId = setTimeout(() => setRefreshUi(s => s + 1), UI_REFRESH_INTERVAL);
        return () => clearTimeout(timeoutId);
    }, [refreshUi]);

    const lastFullRefresh = props.conn.catalogUpdates.lastFullRefresh
    const sinceLastFullRefresh = React.useMemo(() => {
        let sinceLastFullRefresh = null;
        if (lastFullRefresh != null) {
            const task = props.conn!.catalogUpdates.tasksRunning.get(lastFullRefresh)
                ?? props.conn!.catalogUpdates.tasksFinished.get(lastFullRefresh)
                ?? null;
            if (task?.startedAt != null) {
                sinceLastFullRefresh = formatTimeDifference(task.startedAt);
            }
        }
        return sinceLastFullRefresh;
    }, [refreshUi]);

    const Metric = (props: { name: string, value: string }) => (
        <>
            <div className={styles.catalog_metric_key}>
                {props.name}
            </div>
            <div className={styles.catalog_metric_value}>
                {props.value}
            </div>
        </>
    );
    const AdditionalEntry = (props: { name: string, value: string }) => (
        <>
            <div className={styles.additional_entry_key}>
                {props.name}
            </div>
            <div className={styles.additional_entry_value}>
                {props.value}
            </div>
        </>
    );

    const ExpandIcon = SymbolIcon("triangle_down_24");
    const CollapseIcon = SymbolIcon("triangle_up_24");
    const [expanded, setExpanded] = React.useState<boolean>();
    const TriangleIcon = expanded ? CollapseIcon : ExpandIcon;

    // Expand if we're forced, auto-close if this changes
    const prevAlwaysExpand = React.useRef<boolean | null>(null);
    React.useEffect(() => {
        const prev = prevAlwaysExpand.current;
        prevAlwaysExpand.current = props.alwaysExpand;

        if (prev != null && prev && !props.alwaysExpand && expanded) {
            setExpanded(false);
        } else if (props.alwaysExpand && !expanded) {
            setExpanded(true);
        }
    }, [props.alwaysExpand, expanded]);

    return (
        <div className={styles.root}>
            <motion.div
                className={styles.root_background}
                layoutId="catalog_info_background"
                layout="size"
                transition={{ duration: 0.2, ease: [0.33, 1, 0.68, 1] }}
            />
            <div className={styles.header}>
                <div
                    className={styles.header_title}
                    onClick={props.alwaysExpand
                        ? () => { }
                        : (ev: React.MouseEvent) => {
                            ev.stopPropagation();
                            setExpanded(e => !e);
                        }}
                >
                    Catalog
                </div>
                {!props.alwaysExpand && (
                    <div className={styles.header_button}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-labelledby="info-expand"
                            aria-label={expanded ? "Hide Info" : "Show Info"}
                            onClick={(ev: React.MouseEvent) => {
                                ev.stopPropagation();
                                setExpanded(e => !e);
                            }}
                        >
                            <TriangleIcon />
                        </IconButton>
                    </div>
                )}
            </div>
            {expanded && (
                <>
                    <div className={styles.catalog_metrics}>
                        <Metric name="Last Refresh" value={sinceLastFullRefresh ?? "-"} />
                        <Metric name="Databases" value={Intl.NumberFormat().format(catalogStats.dbCount)} />
                        <Metric name="Schemas" value={Intl.NumberFormat().format(catalogStats.schemaCount)} />
                        <Metric name="Tables" value={Intl.NumberFormat().format(catalogStats.tableCount)} />
                        <Metric name="Columns" value={Intl.NumberFormat().format(catalogStats.columnCount)} />
                    </div>
                    {props.entries.length > 0 &&
                        <div className={styles.additional_entries}>
                            {props.entries.map(([n, v], i) => (
                                <AdditionalEntry key={i} name={n} value={v} />
                            ))}
                        </div>
                    }
                </>
            )}
        </div>
    );
}
