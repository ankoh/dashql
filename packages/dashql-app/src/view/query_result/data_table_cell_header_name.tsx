import * as arrow from 'apache-arrow';
import * as React from 'react';
import * as styles from './data_table.module.css';
import symbols from '../../../static/svg/symbols.generated.svg';

import { classNames } from '../../utils/classnames.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../view/foundations/button.js';
import { AsyncDataFrame } from '../../compute/compute_worker_bindings.js';
import { DataTableLayout } from './data_table_layout.js';

/// ---------------------------------------------------------------------------
/// Header Name Cell
/// ---------------------------------------------------------------------------

export interface HeaderNameCellProps {
    columnIndex: number;
    style: React.CSSProperties;
    table: arrow.Table;
    gridLayout: DataTableLayout;
    dataFrame: AsyncDataFrame | null;
    onOrderByColumn: (col: number) => void;
}

export function HeaderNameCell(props: HeaderNameCellProps): React.ReactElement {
    if (props.columnIndex >= props.gridLayout.arrowFieldByColumnIndex.length) {
        return <div style={props.style} />;
    }
    const fieldId = props.gridLayout.arrowFieldByColumnIndex[props.columnIndex];

    if (props.columnIndex == 0) {
        // Corner cell (top-left)
        return (
            <div className={styles.header_corner_cell} style={props.style}>
                <span className={styles.header_cell_actions}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="sort-column"
                        onClick={() => props.onOrderByColumn(fieldId)}
                        disabled={props.dataFrame == null}
                    >
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#sort_desc_16`} />
                        </svg>
                    </IconButton>
                </span>
            </div>
        );
    } else {
        // Regular header cell
        return (
            <div
                className={classNames(styles.header_cell, {
                    [styles.header_metadata_cell]: props.gridLayout.isSystemColumn[props.columnIndex] == 1
                })}
                style={props.style}
            >
                <span className={styles.header_cell_name}>
                    {props.table.schema.fields[fieldId].name}
                </span>
                <span className={styles.header_cell_actions}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="sort-column"
                        onClick={() => props.onOrderByColumn(fieldId)}
                        disabled={props.dataFrame == null}
                    >
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#sort_desc_16`} />
                        </svg>
                    </IconButton>
                </span>
            </div>
        );
    }
}
