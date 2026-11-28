import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './data_table_row_detail.module.css';

import { dataTypeToString, type ArrowTableFormatter } from '@akohn/dashql/platform/compute/arrow_formatter';
import { ButtonSize, ButtonVariant, IconButton } from '../button.js';
import { Sheet } from '../sheet.js';
import { ChevronDownIcon, ChevronUpIcon } from '../symbol_icon.js';
import type { DataTableLayout } from './data_table_layout.js';

/// A field of the row that the detail shows
export interface RowDetailField {
    name: string;
    /// The type of the column as the header of the table names it, e.g. Int32
    type: string;
    /// The formatted value, null for null
    value: string | null;
}

/// The detail of a row that is open: the row as it shows in the table and its fields in the order of the columns
export interface RowDetail {
    visibleRow: number;
    fields: RowDetailField[];
}

/// The detail of a row of a table of rows that show, the row that shows as `visibleRow`: the fields of the columns of
/// the layout, without the row number. Null for a row outside of the table.
export function rowDetailOf(table: arrow.Table, formatter: ArrowTableFormatter, layout: DataTableLayout, row: number, visibleRow: number): RowDetail | null {
    if (row < 0 || row >= table.numRows) return null;
    const fields: RowDetailField[] = [];
    for (let column = 1; column < layout.arrowFieldByColumnIndex.length; ++column) {
        const fieldId = layout.arrowFieldByColumnIndex[column];
        const field = table.schema.fields[fieldId];
        if (field == null) continue;
        fields.push({ name: field.name, type: dataTypeToString(field.type), value: formatter.getValue(row, fieldId) });
    }
    return { visibleRow, fields };
}

interface Props {
    detail: RowDetail;
    /// The rows of the table
    rowCount: number;
    /// Show the row before or after
    onNavigate: (delta: number) => void;
    onClose: () => void;
}

/// The fields of a row of a result in a sheet, a field per line: what a phone can't show side by side in the grid and
/// a wide window shows next to it (docs/design/narrow_layouts.md). The arrows step through the rows.
export function DataTableRowDetail(props: Props): React.ReactElement {
    const { detail, rowCount, onNavigate } = props;
    return (
        <Sheet
            title={`Row ${detail.visibleRow + 1} of ${rowCount}`}
            onClose={props.onClose}
            data-testid="data-table-row-detail"
            actions={<>
                <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible} aria-label="Previous row"
                    data-testid="data-table-row-previous" disabled={detail.visibleRow <= 0} onClick={() => onNavigate(-1)}>
                    <ChevronUpIcon size={16} />
                </IconButton>
                <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible} aria-label="Next row"
                    data-testid="data-table-row-next" disabled={detail.visibleRow >= rowCount - 1} onClick={() => onNavigate(1)}>
                    <ChevronDownIcon size={16} />
                </IconButton>
            </>}
        >
            <dl className={styles.fields}>
                {detail.fields.map((field, index) => (
                    <div key={index} className={styles.field} data-testid="data-table-row-field">
                        <dt className={styles.name}>
                            {field.name}
                            <span className={styles.type}>{field.type}</span>
                        </dt>
                        <dd className={field.value == null ? `${styles.value} ${styles.value_null}` : styles.value}>{field.value ?? 'null'}</dd>
                    </div>
                ))}
            </dl>
        </Sheet>
    );
}
