import * as React from 'react';

import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { QueryProgressPanel as QueryProgressPanelView } from '@akohn/dashql-react/components/query_progress/query_progress_panel';
import { useQueryProfileDetail } from '@akohn/dashql-react/hooks';

interface Props {
    query: QueryExecutionState;
    /// Show the profile of the query (the plan with its stages) once the plan is known
    showProfile?: boolean;
    /// The height of the profile in pixels, 360 by default
    profileHeight?: number;
}

/// The progress of a query in the app (QueryProgressPanel of @akohn/dashql-react): the connector fetches the plan and
/// its statistics while the profile shows
export function QueryProgressPanel(props: Props) {
    useQueryProfileDetail(props.query.queryId, props.showProfile === true);
    return <QueryProgressPanelView {...props} />;
}
