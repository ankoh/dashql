import * as React from "react";
import * as styles from "./catalog_statistics_overlay.module.css";

import { Box } from "@primer/react";

import { AnchorAlignment } from "../../view/foundations/anchored_position.js";
import { AnchoredOverlay } from "../../view/foundations/anchored_overlay.js";
import { ButtonVariant, IconButton } from "../../view/foundations/button.js";
import { ConnectionState } from "../../connection/connection_state.js";
import { SymbolIcon } from "../../view/foundations/symbol_icon.js";
import { formatTimeDifference } from "../../utils/format.js";

interface CatalogInfoViewProps {
    connection: ConnectionState;
    close: () => void;
}

interface CatalogStats {
    dbCount: number;
    schemaCount: number;
    tableCount: number;
    columnCount: number;
}

const UI_REFRESH_INTERVAL = 5000;

export function CatalogStatisticsView(props: CatalogInfoViewProps) {
    const snap = props.connection.catalog.createSnapshot();
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

    const lastFullRefresh = props.connection.catalogUpdates.lastFullRefresh
    const sinceLastFullRefresh = React.useMemo(() => {
        let sinceLastFullRefresh = null;
        if (lastFullRefresh != null) {
            const task = props.connection!.catalogUpdates.tasksRunning.get(lastFullRefresh)
                ?? props.connection!.catalogUpdates.tasksFinished.get(lastFullRefresh)
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

    const XIcon = SymbolIcon("x_16");
    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <div className={styles.header_title}>
                    Statistics
                </div>
                <div className={styles.header_close}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Close Overlay"
                        onClick={(ev: React.MouseEvent) => {
                            ev.stopPropagation();
                            props.close();
                        }}
                    >
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.catalog_metrics}>
                <Metric name="Last Refresh" value={sinceLastFullRefresh ?? "-"} />
                <Metric name="Databases" value={Intl.NumberFormat().format(catalogStats.dbCount)} />
                <Metric name="Schemas" value={Intl.NumberFormat().format(catalogStats.schemaCount)} />
                <Metric name="Tables" value={Intl.NumberFormat().format(catalogStats.tableCount)} />
                <Metric name="Columns" value={Intl.NumberFormat().format(catalogStats.columnCount)} />
            </div>
        </div>
    );
}

interface Props {
    anchorClassName?: string;
    connection: ConnectionState;
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
}

export const CatalogStatisticsOverlay: React.FC<Props> = (props: Props) => {
    const anchorRef = React.createRef<HTMLDivElement>();
    const buttonRef = React.createRef<HTMLButtonElement>();

    return (
        <AnchoredOverlay
            renderAnchor={() => <div ref={anchorRef} className={props.anchorClassName} />}
            open={props.isOpen}
            onClose={() => props.setIsOpen(false)}
            anchorRef={anchorRef}
            align={AnchorAlignment.End}
            overlayProps={{
                initialFocusRef: buttonRef,
            }}
        >
            <Box>
                <CatalogStatisticsView
                    connection={props.connection}
                    close={() => props.setIsOpen(false)}
                />
            </Box>
        </AnchoredOverlay>
    );
};
