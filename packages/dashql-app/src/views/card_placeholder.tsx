import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';
import * as styles from './card_placeholder.module.css';

import { useAppFlavor } from '../config/flavor_provider.js';
import { classNames } from '../utils/classnames.js';
import { QueryExecutionStatus, queryIsDone, type QueryExecutionState } from '../query/query_execution_state.js';

/// The hint of a card before the first run
const RUN_HINT = 'Run the query to see the result';

/// What the query of a card without a result does, null when it did not run and the card shows the hint
function queryStatusMessage(query: QueryExecutionState | null): string | null {
    if (query == null) return null;
    if (!queryIsDone(query.status)) return 'Running the query…';
    if (query.status === QueryExecutionStatus.FAILED) return 'The query failed';
    if (query.status === QueryExecutionStatus.CANCELLED) return 'The query was cancelled';
    return null;
}

/// A card that has nothing to show yet: the logo of the flavor, faint, with the message below it.
/// A hint is quieter than a status, it must not compete with the cards that show results.
export function CardPlaceholder(props: { message: string; hint?: boolean }): React.ReactElement {
    const logo = useAppFlavor().logo;
    return (
        <div className={styles.root} data-testid="card-placeholder">
            <svg
                className={classNames(styles.logo, { [styles.logo_wordmark]: logo.wordmark })}
                style={logo.wordmark ? { aspectRatio: logo.aspectRatio } : undefined}
                aria-hidden="true"
            >
                <use xlinkHref={`${symbols}#${logo.symbol}`} />
            </svg>
            <span className={props.hint ? styles.hint : styles.message}>{props.message}</span>
        </div>
    );
}

/// The placeholder of a card whose query has no result: the hint to run it, else what the query does
export function QueryStatusPlaceholder(props: { query: QueryExecutionState | null }): React.ReactElement {
    const status = queryStatusMessage(props.query);
    return status != null ? <CardPlaceholder message={status} /> : <CardPlaceholder message={RUN_HINT} hint />;
}
