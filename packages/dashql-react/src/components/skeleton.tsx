import * as React from 'react';
import * as styles from './skeleton.module.css';

import { CardPlaceholder } from './card_placeholder.js';

/// Stands in for content that renders in a calm frame, e.g. a chart, a table or Markdown (`Deferred` of
/// `components/deferred`): the faint logo of the flavor like on a card without a result, a shine passes over it. It
/// fills the box of its parent.
export function Skeleton(): React.ReactElement {
    return (
        <div className={styles.root} data-testid="skeleton" aria-busy="true" aria-label="Loading">
            <CardPlaceholder />
        </div>
    );
}
