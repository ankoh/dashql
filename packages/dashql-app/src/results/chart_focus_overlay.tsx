import * as React from 'react';
import * as styles from './chart_focus_overlay.module.css';

import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import { ResultTableOverlay as ResultTableOverlayView } from '@akohn/dashql-react/components/query_result/result_table_overlay';
import { useObservedSize } from '@akohn/dashql-react/components/size_observer';
import { VisualizationDispatch } from './visualization_dispatch.js';

interface Props {
    scriptName: string;
    model: QueryModel;
    visualizeQuery: ResolvedVisualizeQuery;
    onClose: () => void;
}

/// The chart of a feed entry in a card over the page, like its full result table (ResultTableOverlay of
/// @akohn/dashql-react): enlarged to the window below the top bar, a compact window fills with it
/// (docs/design/narrow_layouts.md). The chart takes the size of the card, the same spec as in the feed.
export function ChartFocusOverlay(props: Props): React.ReactElement {
    return (
        <ResultTableOverlayView scriptName={props.scriptName} subject="Chart" onClose={props.onClose}>
            {layout => <ChartFocusBody {...props} height={layout.fitHeight ? layout.maxHeight : undefined} />}
        </ResultTableOverlayView>
    );
}

/// The chart in the body of the card, measured: the enlarged card gives it the body, a restored one a fixed height
function ChartFocusBody(props: Props & { height?: number }): React.ReactElement {
    const bodyRef = React.useRef<HTMLDivElement>(null);
    const size = useObservedSize(bodyRef);
    return (
        <div ref={bodyRef} className={styles.body} style={props.height == null ? undefined : { height: props.height }} data-testid="chart-focus">
            {size != null && size.width > 0 && size.height > 0 && (
                <VisualizationDispatch model={props.model} visualizeQuery={props.visualizeQuery} width={size.width} height={size.height} />
            )}
        </div>
    );
}
