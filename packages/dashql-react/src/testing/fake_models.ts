import { vi } from 'vitest';

import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';

import type { ScriptModel } from '../models/script_model.js';
import type { QueryModel } from '../models/query_model.js';
import type { ComputationModel } from '../models/computation_model.js';
import type * as arrow from 'apache-arrow';
import type { ComputationView } from '@akohn/dashql';
import { QueryExecutionStatus, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { mockTableComputation } from './computation_mocks.js';

/// A script as the tests of components need it: its key, its file name, its text and nothing that runs
export function fakeScript(scriptKey: number, fileName: string, text = 'SELECT 1', overrides: Partial<ScriptData> = {}): ScriptData {
    return {
        scriptKey, fileName, workbookId: 'workbook', connectionId: 'database', scriptSession: { getText: () => text },
        analysisOutdated: true, annotations: {}, statistics: [], pendingDiff: null, latestQueryId: null, storedResult: null,
        ...overrides,
    } as unknown as ScriptData;
}

/// A model of a script without a runtime: its operations are spies that resolve at once
export function fakeScriptModel(overrides: Partial<ScriptModel> = {}): ScriptModel {
    return {
        workbookId: 'workbook',
        script: fakeScript(1, 'script.sql'),
        query: null,
        runActive: false,
        run: vi.fn(async () => { }),
        cancel: vi.fn(async () => { }),
        setText: vi.fn(async () => { }),
        acceptDiff: vi.fn(async () => { }),
        rejectDiff: vi.fn(async () => { }),
        setVisSpec: vi.fn(async () => { }),
        ...overrides,
    };
}

/// A model of a query without a runtime, of a query that the test describes: `cancel` is a spy
export function fakeQueryModel(query: Partial<QueryExecutionState> & { queryId: number }, overrides: Partial<QueryModel> = {}): QueryModel {
    return {
        queryId: query.queryId,
        query: query as QueryExecutionState,
        progress: query.progress ?? null,
        result: null,
        computation: null,
        cancel: vi.fn(async () => { }),
        ...overrides,
    };
}

/// The model of a computation: its view and the Arrow tables of its handles, an action is recorded and changes nothing.
/// The rows that show are the rows of the table of the computation in their order, a read slices them.
export function fakeComputationModel(
    computation: ComputationView,
    tables: ReadonlyMap<number, arrow.Table> = new Map(),
    overrides: Partial<ComputationModel> = {},
): ComputationModel {
    return {
        computation,
        tables: { table: handle => handle == null ? undefined : tables.get(handle) },
        dispatch: vi.fn(() => ({ ok: true, changed: true, error: null, id: null })),
        readRows: vi.fn(async (offset: number, limit: number) => {
            const table = tables.get(computation.dataTable);
            if (table == null) throw new Error(`no table ${computation.dataTable}`);
            return { offset, rows: table.numRows, table: table.slice(offset, offset + limit) };
        }),
        previewRows: vi.fn(async (offset: number, limit: number) => {
            const table = tables.get(computation.dataTable);
            if (table == null) throw new Error(`no table ${computation.dataTable}`);
            return table.slice(offset, offset + limit);
        }),
        ...overrides,
    };
}

/// The model of a query that succeeded with a result table: its computation reads the rows of the table
export function fakeResultModel(table: arrow.Table, query: Partial<QueryExecutionState> = {}): QueryModel {
    const computation = mockTableComputation([], { dataTableRows: table.numRows });
    return fakeQueryModel(
        { queryId: 1, status: QueryExecutionStatus.SUCCEEDED, resultTable: { id: 1, rows: table.numRows }, ...query },
        { computation: fakeComputationModel(computation, new Map([[computation.dataTable, table]])) },
    );
}
