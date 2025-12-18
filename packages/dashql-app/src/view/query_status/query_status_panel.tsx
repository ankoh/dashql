import * as React from 'react';
import * as styles from './query_status_panel.module.css';

import { RectangleWaveSpinner } from '../foundations/spinners.js';
import { QueryExecutionState, QueryExecutionStatus } from '../../connection/query_execution_state.js';

interface Props {
    query: QueryExecutionState | null;
}

export const QueryStatusPanel: React.FC<Props> = (props: Props) => {
    const getStatusText = (status: QueryExecutionStatus | null) => {
        if (status == null) {
            return '';
        }
        switch (status) {
            case QueryExecutionStatus.REQUESTED:
                return 'Requested query';
            case QueryExecutionStatus.PREPARING:
                return 'Preparing query';
            case QueryExecutionStatus.SENDING:
                return 'Sending query';
            case QueryExecutionStatus.QUEUED:
                return 'Queued query';
            case QueryExecutionStatus.RUNNING:
                return 'Executing query';
            case QueryExecutionStatus.RECEIVED_FIRST_BATCH:
                return 'Executing query, fetching results';
            case QueryExecutionStatus.RECEIVED_ALL_BATCHES:
                return 'Executing query, received all results';
            case QueryExecutionStatus.PROCESSING_RESULTS:
                return 'Processing results';
            case QueryExecutionStatus.FAILED:
                return 'Query execution failed';
            case QueryExecutionStatus.CANCELLED:
                return 'Query was cancelled';
            case QueryExecutionStatus.SUCCEEDED:
                return 'Query executed successfully';
        }
    };
    if (props.query == null) {
        return <div className={styles.root}></div>;
    }
    switch (props.query.status) {
        case QueryExecutionStatus.PREPARING:
        case QueryExecutionStatus.QUEUED:
        case QueryExecutionStatus.RUNNING:
        case QueryExecutionStatus.RECEIVED_FIRST_BATCH:
        case QueryExecutionStatus.RECEIVED_ALL_BATCHES:
        case QueryExecutionStatus.PROCESSING_RESULTS: {
            return (
                <div className={styles.root}>
                    <RectangleWaveSpinner active={true} />
                    <div className={styles.status_label}>{getStatusText(props.query.status)}</div>
                </div>
            );
        }
        case QueryExecutionStatus.FAILED:
        case QueryExecutionStatus.CANCELLED: {
            return (
                <div className={styles.root}>
                    <div className={styles.error_container}>
                        <div className={styles.error_message}>{props.query.error?.message}</div>
                        <div className={styles.error_keyvalues}>
                            {Object.entries(props.query.error?.keyValues ?? {}).map(([k, v], i) => (
                                <>
                                    <span key={i * 2 + 0} className={styles.error_kv_key}>{k}</span>
                                    <span key={i * 2 + 1} className={styles.error_kv_value}>{v}</span>
                                </>
                            ))}
                        </div>
                    </div>
                </div>
            );
        }
        case QueryExecutionStatus.SUCCEEDED: {
            return (
                <div className={styles.root}>
                    <div className={styles.status_label}>{getStatusText(props.query.status)}</div>
                </div>
            );
        }
    }
};
