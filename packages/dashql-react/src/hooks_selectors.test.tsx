import * as React from 'react';
import { act } from './testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dashql from '@akohn/dashql';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import type { ScriptReferenceReport } from '@akohn/dashql/platform/workbook/script_reference_check';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { analyzeWorkbook, createTestRuntime, type TestRuntime } from '@akohn/dashql/runtime/testing/test_runtime';

import {
    RuntimeContextProvider, useScriptReferences, useViewReader, useViewSelector, useWorkbookInputs,
    type ViewReader,
} from './hooks.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/// A Hyper server, the scripts are analyzed against its catalog without a network
const HYPER = { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } as ConnectionParams;
const CONNECTION = 'database';

/// A probe counts its renders and keeps the value of its last render
interface Probe<T> {
    renders: number;
    value: T | undefined;
}
function probe<T>(): Probe<T> {
    return { renders: 0, value: undefined };
}
function Probed<T>(props: { use: () => T; probe: Probe<T> }) {
    const value = props.use();
    React.useLayoutEffect(() => {
        props.probe.renders += 1;
        props.probe.value = value;
    });
    return null;
}

const selectScriptKeys = (workbook: WorkbookScripts | null) => workbook?.scriptKeys ?? null;

// The hooks that read a part of the views, a component renders again only when its part changes
describe('the selector hooks', () => {
    let rt: TestRuntime;
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(async () => {
        rt = await createTestRuntime();
        await rt.addConnection({ connectionId: CONNECTION, params: HYPER });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(async () => {
        act(() => root.unmount());
        container.remove();
        await rt.destroy();
    });

    function render(children: React.ReactNode) {
        act(() => root.render(<RuntimeContextProvider value={rt}>{children}</RuntimeContextProvider>));
    }
    /// Apply an action to a workbook and flush the store
    function apply(workbookId: string, action: dashql.WorkbookAction) {
        act(() => {
            expect(rt.dispatch({ workbook: workbookId }, action).ok).toBe(true);
            rt.flush();
        });
    }

    it('renders a selector of a slice again only when the selected value changes', () => {
        const workbook = rt.addWorkbook(CONNECTION, [['alpha.sql', 'select 1'], ['beta.sql', 'select 2']]);
        const keys = probe<readonly number[] | null>();
        render(<Probed probe={keys} use={() => useViewSelector('workbook', workbook.workbookId, selectScriptKeys)} />);
        expect(keys.value).toEqual(workbook.scriptKeys);
        expect(keys.renders).toBe(1);

        // A rename changes the workbook and keeps its script keys
        apply(workbook.workbookId, { kind: 'renameScript', value: { fileName: 'beta.sql', newName: 'gamma' } });
        expect(rt.store.get('workbook', workbook.workbookId)).not.toBe(workbook);
        expect(keys.renders).toBe(1);

        // A created script changes them
        apply(workbook.workbookId, { kind: 'createScript', value: { text: 'select 3', base: 'delta' } });
        expect(keys.renders).toBe(2);
        expect(keys.value).toHaveLength(3);
    });

    it('renders a reader of the references of a script only when its report changes, and of the inputs only when they change', () => {
        const workbook = rt.addWorkbook(CONNECTION, [['alpha.sql', 'select 1 as x'], ['beta.sql', 'select x from :alpha'], ['gamma.sql', 'select x from :alpha']]);
        const [, beta, gamma] = workbook.scriptKeys;
        const betaReport = probe<ScriptReferenceReport | null>();
        const gammaReport = probe<ScriptReferenceReport | null>();
        const inputs = probe<unknown[] | null>();
        render(<>
            <Probed probe={inputs} use={() => useWorkbookInputs(workbook.workbookId)} />
            <Probed probe={betaReport} use={() => useScriptReferences(workbook.workbookId, beta)} />
            <Probed probe={gammaReport} use={() => useScriptReferences(workbook.workbookId, gamma)} />
        </>);
        expect(betaReport.value?.marks.map(mark => mark.target)).toEqual(['alpha.sql']);
        expect(gammaReport.value?.marks.map(mark => mark.target)).toEqual(['alpha.sql']);
        const derived = rt.store.get('workbookDerived', workbook.workbookId);

        // A second reference in beta moves the derived view, gamma keeps its report
        apply(workbook.workbookId, { kind: 'setScriptText', value: { scriptKey: beta, text: 'select x from :alpha union all select x from :alpha', withDiff: false } });
        act(() => analyzeWorkbook(rt, workbook.workbookId));
        expect(rt.store.get('workbookDerived', workbook.workbookId)).not.toBe(derived);
        expect(betaReport.value?.marks).toHaveLength(2);
        expect(betaReport.renders).toBe(2);
        expect(gammaReport.renders).toBe(1);
        // The inputs stay
        expect(inputs.value).toEqual([]);
        expect(inputs.renders).toBe(1);
    });

    it('reads the views when it is called, without rendering again', () => {
        const workbook = rt.addWorkbook(CONNECTION, [['alpha.sql', 'select 1']]);
        const key = workbook.scriptKeys[0];
        const reader = probe<ViewReader>();
        render(<Probed probe={reader} use={useViewReader} />);
        const read = reader.value!;
        expect(read('script', key)?.fileName).toBe('alpha.sql');

        apply(workbook.workbookId, { kind: 'renameScript', value: { fileName: 'alpha.sql', newName: 'beta' } });
        expect(reader.renders).toBe(1);
        expect(read('script', key)?.fileName).toBe('beta.sql');
        expect(read('workbook', 'unknown')).toBeNull();
    });
});
