import * as React from 'react';

import { ChevronDownIcon, ChevronRightIcon, TableIcon } from '@akohn/dashql-react/components/symbol_icon';
import { formatBytes } from '@akohn/dashql-react/format/format';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import * as styles from './parquet_file_card.module.css';

/// The table of a Parquet file as the card shows it
export type ParquetTableState =
    /// Not read yet, the card wasn't opened
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'failed'; error: string }
    /// Read and analyzed as a computation
    | { status: 'ready'; tableId: number; rows: number; columns: number };

/// What the card shows of a file of the archive
export interface ParquetFileInfo {
    fileName: string;
    /// The bytes of the entry in the archive
    compressedSize: number;
    /// The bytes of the file
    uncompressedSize: number;
    /// Is the file stored without compression?
    stored: boolean;
}

export interface ParquetFileCardProps {
    file: ParquetFileInfo;
    table: ParquetTableState;
    expanded: boolean;
    onToggle: () => void;
    /// The table of a read file, rendered while the card is expanded
    renderTable: (tableId: number) => React.ReactNode;
}

/// The card of a Parquet file of a `.dashql` file: its name and sizes, and its table when expanded
export function ParquetFileCard({ file, table, expanded, onToggle, renderTable }: ParquetFileCardProps) {
    const bodyId = React.useId();
    const compression = file.stored ? 'stored' : `deflated to ${formatBytes(file.compressedSize)}`;
    return (
        <section className={classNames(styles.card, expanded && styles.card_expanded)} aria-label={file.fileName}>
            <button
                type="button"
                className={styles.header}
                aria-expanded={expanded}
                aria-controls={bodyId}
                onClick={onToggle}
            >
                {expanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
                <TableIcon size={16} className={styles.icon} />
                <span className={styles.name}>{file.fileName}</span>
                {table.status === 'ready' && (
                    <span className={styles.shape}>
                        {table.rows.toLocaleString()} {table.rows === 1 ? 'row' : 'rows'}, {table.columns} {table.columns === 1 ? 'column' : 'columns'}
                    </span>
                )}
                <span className={styles.size} title={compression}>{formatBytes(file.uncompressedSize)}</span>
            </button>
            {expanded && (
                <div id={bodyId} className={styles.body}>
                    {table.status === 'ready' ? renderTable(table.tableId)
                        : table.status === 'failed' ? <div className={styles.error} role="alert">{table.error}</div>
                            : <div className={styles.loading}>Reading the Parquet file…</div>}
                </div>
            )}
        </section>
    );
}
