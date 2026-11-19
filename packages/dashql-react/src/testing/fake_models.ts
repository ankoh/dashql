import { vi } from 'vitest';

import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';

import type { ScriptModel } from '../models/script_model.js';
import type { QueryModel } from '../models/query_model.js';
import type { ComputationModel } from '../models/computation_model.js';
import type * as arrow from 'apache-arrow';
import type { TableComputationState } from '@akohn/dashql/platform/compute/computation_types';
import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';

/// A script as the tests of components need it: its key, its file name, its text and nothing that runs
export function fakeScript(scriptKey: number, fileName: string, text = 'SELECT 1', overrides: Partial<ScriptData> = {}): ScriptData {
    return {
        scriptKey, fileName, workbookId: 'workbook', connectionId: 'database', scriptSession: { getText: () => text },
        analysisOutdated: true, annotations: {}, statistics: [], pendingDiff: null, latestQueryId: null, cachedResult: null,
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
        cancel: vi.fn(async () => { }),
        ...overrides,
    };
}

/// The model of a computation: its view and the Arrow tables of its handles, an action is recorded and changes nothing
export function fakeComputationModel(
    computation: TableComputationState,
    tables: ReadonlyMap<number, arrow.Table> = new Map(),
    overrides: Partial<ComputationModel> = {},
): ComputationModel {
    return {
        computation,
        tables: { table: handle => handle == null ? undefined : tables.get(handle) },
        dispatch: vi.fn(() => ({ ok: true, changed: true, error: null, id: null })),
        ...overrides,
    };
}
