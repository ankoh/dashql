import * as React from 'react';

import type * as core from '@akohn/dashql';
import type { ComputationView } from '@akohn/dashql';
import type { ResultRowWindow } from '@akohn/dashql/runtime';
import type { SummaryTables } from '@akohn/dashql/platform/compute/computation_types';

import { useComputationDispatch, useOptionalRuntime } from '../hooks.js';

// The model of the computation of a result table (docs/agents/writing_components.md): what the data table shows of it
// and what it can do with it. The views, the handles of the Arrow tables and the actions of the runtime stay in this
// module.

/// The computation of a result table as a component shows it, and what the component can do with it
export interface ComputationModel {
    /// The computation: its columns, summaries, filters, ordering and searches, with the handles of their tables
    readonly computation: ComputationView;
    /// The Arrow tables of the handles of the computation
    readonly tables: SummaryTables;

    /// Change the computation: filter, order, search, ask for summaries
    dispatch(action: core.ComputationAction): core.DispatchOutcome;
    /// Read a window of the rows that show: those that pass the filters and the data search, in the order of the
    /// ordering, from `offset`, at most `limit`
    readRows(offset: number, limit: number): Promise<ResultRowWindow>;
}

export type { ResultRowWindow };

/// The tables of no runtime
const NO_TABLES: SummaryTables = { table: () => undefined };

/// The rows of no runtime
const noRows = async (): Promise<ResultRowWindow> => {
    throw new Error('there is no runtime to read the rows from');
};

/// The model of a computation, null without one. It renders again when the computation changes and no other.
export function useComputationModel(computation: ComputationView | null | undefined): ComputationModel | null {
    const runtime = useOptionalRuntime();
    const dispatch = useComputationDispatch(computation?.tableId);
    return React.useMemo(() => {
        if (computation == null) return null;
        const tableId = computation.tableId;
        const readRows = runtime == null
            ? noRows
            : (offset: number, limit: number) => runtime.readResultRows(tableId, offset, limit);
        return { computation, tables: runtime ?? NO_TABLES, dispatch, readRows };
    }, [runtime, computation, dispatch]);
}
