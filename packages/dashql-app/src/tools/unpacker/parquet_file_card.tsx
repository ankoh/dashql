import * as React from 'react';

import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { ChevronDownIcon, ChevronRightIcon, ScreenFullIcon, TableIcon } from '@akohn/dashql-react/components/symbol_icon';
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
    /// Open the full table of a read file in a card over the page
    onShowTable: () => void;
    /// The preview of the table of a read file, rendered while the card is expanded
    renderTable: (tableId: number) => React.ReactNode;
}

/// The card of a Parquet file of a `.dashql` file: its name and sizes, and a preview of its table when expanded. The
/// button next to the header opens the full table once the file is read.
export function ParquetFileCard({ file, table, expanded, onToggle, onShowTable, renderTable }: ParquetFileCardProps) {
    const bodyId = React.useId();
    const compression = file.stored ? 'stored' : `deflated to ${formatBytes(file.compressedSize)}`;
    return (
        <section className={classNames(styles.card, expanded && styles.card_expanded)} aria-label={file.fileName}>
            <div className={styles.header_row}>
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
                {table.status === 'ready' && (
                    <IconButton
                        className={styles.show_table}
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={`Open the table of ${file.fileName}`}
                        description="Open the table"
                        onClick={onShowTable}
                    >
                        <ScreenFullIcon size={16} />
                    </IconButton>
                )}
            </div>
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
