import * as React from 'react';
import type { TopLevelSpec } from 'vega-lite';

import * as styles from './visualization.module.css';
import { createVegaLitePreviewConfig } from '../../ui/vegalite/vegalite_theme.js';
import { QueryExecutionState } from '../../query/query_execution_state.js';
import { VegaLiteView, type VegaLiteViewDependencies } from './vegalite_view.js';

/// The inset of the chart in its box, the padding of the preview style
export const VEGALITE_PREVIEW_INSET = 8;

interface Props {
    query: QueryExecutionState | null;
    vegaLiteSpec: TopLevelSpec | null;
    /// The size of the box of the preview, the chart fits into it with its inset
    width: number;
    height: number;
    dependencies?: VegaLiteViewDependencies;
}

/// A chart in a small box, e.g. on the dataflow canvas: the preview config with smaller text and marks, no legends,
/// and the whole plot fitted into the box
export function VegaLitePreview(props: Props): React.ReactElement {
    return (
        <VegaLiteView
            query={props.query}
            vegaLiteSpec={props.vegaLiteSpec}
            width={Math.max(0, props.width - 2 * VEGALITE_PREVIEW_INSET)}
            height={Math.max(0, props.height - 2 * VEGALITE_PREVIEW_INSET)}
            config={createVegaLitePreviewConfig}
            className={styles.preview}
            hideLegend
            dependencies={props.dependencies}
        />
    );
}
