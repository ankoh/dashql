import * as React from 'react';
import * as styles from './query_result_view.module.css';

import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import { DataTableView } from './data_table_view.js';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { classNames } from '@akohn/dashql-react/dom/classnames';

interface Props {
    model: QueryModel | null;
    maxRows?: number;
    columnHeader?: TableColumnHeader;
    onShowTable?: () => void;
    /// Show the rows that `maxRows` leaves out in place instead of opening the full table
    onShowMoreRows?: () => void;
    /// Show only the first rows again
    onShowFewerRows?: () => void;
    fitHeight?: boolean;
    fillHeight?: boolean;
    maxHeight?: number;
    compact?: boolean;
}

export function QueryResultView(props: Props) {
    // The computation of the result of the query
    const computation = props.model?.computation ?? null;
    if (computation == null) {
        return <div />;
    }
    // Toggle data info
    return (
        <div className={classNames(styles.root, { [styles.root_fit_height]: props.fitHeight })}>
            <DataTableView
                className={styles.data_table}
                model={computation}
                maxRows={props.maxRows}
                columnHeader={props.columnHeader}
                onShowTable={props.onShowTable}
                onShowMoreRows={props.onShowMoreRows}
                onShowFewerRows={props.onShowFewerRows}
                fitHeight={props.fitHeight}
                fillHeight={props.fillHeight}
                maxHeight={props.maxHeight}
                compact={props.compact}
            />
        </div>
    );
}
