import * as React from 'react';

import * as styles from './capped_rows.module.css';
import { AlertIcon } from '../symbol_icon.js';
import { classNames } from '../../dom/classnames.js';

const ROW_COUNT_FORMAT = new Intl.NumberFormat('en-US');

/// The text of a view that shows only part of the rows of a result
export function cappedRowsText(part: 'first' | 'last', shown: number, rows: number): string {
    return `Showing the ${part} ${ROW_COUNT_FORMAT.format(shown)} of ${ROW_COUNT_FORMAT.format(rows)} rows`;
}

export interface CappedRowsProps {
    /// The rows that the view shows, the first or the last ones of the result
    part: 'first' | 'last';
    /// How many rows the view shows
    shown: number;
    /// How many rows the result has
    rows: number;
    /// The place of the note in the view
    className?: string;
}

/// The warning of a view that caps the rows of a result, e.g. a chart that draws only its first rows: a warning
/// triangle with the rows that show and the rows of the result
export function CappedRows(props: CappedRowsProps): React.ReactElement {
    return (
        <div
            className={classNames(styles.root, props.className)}
            role="status"
            title="The view caps the rows of the result, aggregate the query to show all of them"
            data-testid="capped-rows"
        >
            <AlertIcon size={16} className={styles.icon} aria-hidden="true" />
            <span>{cappedRowsText(props.part, props.shown, props.rows)}</span>
        </div>
    );
}
