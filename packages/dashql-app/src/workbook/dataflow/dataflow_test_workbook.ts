import type { ConnectionParams } from '@ankoh/dashql/platform/connections/connection_params';
import { analyzeWorkbook, createTestRuntime, type TestRuntime } from '@ankoh/dashql/runtime/testing/test_runtime';
import type { ScriptDataMap, WorkbookDerived, WorkbookScripts } from '@ankoh/dashql/platform/workbook/scripts/workbook_scripts';

/// A workbook of a test on a runtime of its own: the workbook, its scripts and its derived view of the last flush
export interface TestWorkbook {
    runtime: TestRuntime;
    workbook: WorkbookScripts;
    scripts: ScriptDataMap;
    derived: WorkbookDerived | null;
}

/// The params of the embedded Hyper of the tests
const EMBEDDED: ConnectionParams = { hyper: { endpoint: '', protocol: 'WASM' } } as ConnectionParams;

/// The workbook of a test as the runtime holds it now
export function readTestWorkbook(runtime: TestRuntime, workbookId: string): TestWorkbook {
    runtime.flush();
    const workbook = runtime.store.get('workbook', workbookId);
    if (workbook == null) throw new Error(`the runtime holds no workbook ${workbookId}`);
    return {
        runtime,
        workbook,
        scripts: runtime.scripts(workbookId),
        derived: runtime.store.get('workbookDerived', workbookId),
    };
}

/// A workbook of analyzed scripts on one connection, the declarations of every script are in the catalog
export async function analyzedTestWorkbook(entries: Array<[string, string]>): Promise<TestWorkbook> {
    const runtime = await createTestRuntime();
    runtime.addConnection({ connectionId: 'main', params: EMBEDDED });
    const workbook = runtime.addWorkbook('main', entries, { name: 'Dataflow' });
    return readTestWorkbook(runtime, workbook.workbookId);
}

/// A workbook with one more script, analyzed with the catalog of the other scripts
export function withTestScript(test: TestWorkbook, fileName: string, text: string): TestWorkbook {
    const { runtime, workbook } = test;
    runtime.dispatch({ workbook: workbook.workbookId }, { kind: 'createScript', value: { text, base: fileName.replace(/\.sql$/i, '') } });
    analyzeWorkbook(runtime, workbook.workbookId);
    return readTestWorkbook(runtime, workbook.workbookId);
}
