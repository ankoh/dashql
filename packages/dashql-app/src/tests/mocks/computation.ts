import { vi } from 'vitest';

import { createTableComputationState, SCHEDULE_TASK, type ComputationAction, type TableComputationState } from '../../compute/computation_state.js';
import type { ColumnGroup, TaskVariant } from '../../compute/computation_types.js';
import type { AsyncValue } from '../../utils/async_value.js';
import { mockDataFrame } from './compute_query.js';
import { tableFromArrays } from '../arrow_fixtures.js';

/// Table 1 with the column groups, a data frame of a table without a database and the row number column `rownum`
export function mockTableComputation(columnGroups: ColumnGroup[], fields: Partial<TableComputationState> = {}): TableComputationState {
    const table = tableFromArrays({ rownum: Int32Array.from([0, 1, 2]) });
    return {
        ...createTableComputationState(1, table, columnGroups, new AbortController()),
        dataFrame: mockDataFrame('input'),
        rowNumberColumnName: 'rownum',
        ...fields,
    };
}

/// A dispatch of computation actions that records the actions and the scheduled tasks.
/// The tasks of scheduleTask() settle when the test resolves or rejects their result.
export function recordingDispatch() {
    const actions: ComputationAction[] = [];
    const dispatch = vi.fn((action: ComputationAction) => { actions.push(action); });
    const scheduled = (type: symbol) => actions
        .filter(action => action.type === SCHEDULE_TASK)
        .map(action => action.value as TaskVariant & { result: AsyncValue<unknown, Error> })
        .filter(task => task.type === type);
    const ofType = (type: symbol) => actions.filter(action => action.type === type);
    return { dispatch, actions, scheduled, ofType };
}
