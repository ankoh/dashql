import * as React from 'react';
import DataGrid from './data_grid';
import { TableMetadata } from '../../model/table_metadata';
import { SimpleScanProvider } from '../../access/simple_scan_provider';
import { ScanRequest, OrderSpecification, SCAN_RESULT, SCAN_STATISTICS } from '../../access/scan_provider';
import { formatBytes, formatThousands } from './format';

import styles from './table_viewer.module.css';

interface Props {
    /// The table
    table: TableMetadata | null;
    /// Show statistics?
    stats?: boolean;
}

export const TableViewer: React.FC<Props> = (props: Props) => {
    const data = React.useContext(SCAN_RESULT);
    const stats = React.useContext(SCAN_STATISTICS);
    if (props.table == null || data == null) {
        return <div />;
    }
    return (
        <div className={styles.container}>
            <div className={styles.table}>
                <DataGrid table={props.table} />
            </div>
            {props.stats && (
                <div className={styles.statsbar}>
                    <div className={styles.bean}>
                        Scans: &sum; {formatThousands(stats!.resultRows)} rows, &sum; {formatBytes(stats!.resultBytes)},
                        &#8709; {Math.round((stats!.queryExecutionTotalMs / stats!.queryCount) * 100) / 100} ms
                    </div>
                    <div className={styles.bean}>Table: {formatThousands(props.table.row_count || 0)} rows</div>
                </div>
            )}
        </div>
    );
};

interface WiredProps {
    /// The table
    table: TableMetadata | null;
    /// Show statistics?
    stats?: boolean;
    /// The ordering (if any)
    ordering?: OrderSpecification[];
}

export const ScanningTableViewer: React.FC<WiredProps> = (props: WiredProps) => {
    if (props == null || props.table == null) {
        return <div />;
    }
    return (
        <SimpleScanProvider
            table={props.table}
            request={new ScanRequest().withRange(0, 128).withOrdering(props.ordering ?? null)}
        >
            <TableViewer table={props.table} stats={props.stats} />
        </SimpleScanProvider>
    );
};
