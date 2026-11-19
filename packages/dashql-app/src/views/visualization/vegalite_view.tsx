import * as React from 'react';

import { useComputation, useOptionalRuntime, useQueryResultTable } from '@akohn/dashql-react/hooks';
import { useComputationTables } from '@akohn/dashql-react/components/data_table/data_table';
import {
    useNearViewport,
    VegaLiteView as VegaLiteChartView,
    type ResultComputation,
    type VegaLiteViewDependencies as VegaLiteChartDependencies,
    type VegaLiteViewProps,
} from '@akohn/dashql-react/components/vegalite_view';

export { useNearViewport };

// The chart of the result of a query in the app (VegaLiteView of @akohn/dashql-react): the result table and the
// computation of the runtime

export interface VegaLiteViewDependencies extends VegaLiteChartDependencies {
    /// The computation of the result of a query with its tables, null without one
    useResultComputation(queryId: number | null): ResultComputation | null;
}

/// The computation of the result of a query with its tables, null without one
function useResultComputation(queryId: number | null): ResultComputation | null {
    const computation = useComputation(queryId);
    const tables = useComputationTables(computation, useOptionalRuntime());
    return React.useMemo(
        () => computation == null ? null : { rowNumberColumnName: computation.rowNumberColumnName, tables },
        [computation?.rowNumberColumnName, computation == null, tables],
    );
}

type Props = Omit<VegaLiteViewProps, 'resultTable' | 'resultComputation' | 'dependencies'> & {
    dependencies?: VegaLiteViewDependencies;
};

/// The chart of the result of a query
export function VegaLiteView({ dependencies, ...props }: Props): React.ReactElement {
    const useResult = dependencies?.useResultComputation ?? useResultComputation;
    const resultComputation = useResult(props.query?.queryId ?? null);
    const resultTable = useQueryResultTable(props.query);
    return <VegaLiteChartView {...props} resultTable={resultTable} resultComputation={resultComputation} dependencies={dependencies} />;
}
