import * as React from 'react';
import { act } from './testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dashql from '@akohn/dashql';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import type { ScriptReferenceReport } from '@akohn/dashql/platform/workbook/script_reference_check';
import type { ScriptDataMap, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { analyzeWorkbook, createTestRuntime, type TestRuntime } from '@akohn/dashql/runtime/testing/test_runtime';

import {
    RuntimeContextProvider, useScriptReferences, useViewReader, useViewSelector, useWorkbookScriptMap, useWorkbookScriptsSelector,
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
const selectFileNames = (scripts: ScriptDataMap) => Object.values(scripts).map(script => script.fileName).join(',');

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

    it('keeps the selected value with a new selector while it is equal', () => {
        const workbook = rt.addWorkbook(CONNECTION, [['alpha.sql', 'select 1']]);
        // The values of the renders
        const values: number[][] = [];
        const sameKeys = (left: number[], right: number[]) => left.length === right.length && left.every((key, i) => key === right[i]);
        const Counting = () => {
            const [, setTick] = React.useState(0);
            // A new selector and a new array with every render, equal by their contents
            const value = useViewSelector('workbook', workbook.workbookId, view => [...(view?.scriptKeys ?? [])], sameKeys);
            React.useLayoutEffect(() => { values.push(value); });
            return <button onClick={() => setTick(tick => tick + 1)} />;
        };
        render(<Counting />);
        act(() => container.querySelector('button')!.click());
        expect(values).toHaveLength(2);
        expect(values[1]).toBe(values[0]);
        // A rename selects an equal array, the component doesn't render
        apply(workbook.workbookId, { kind: 'renameScript', value: { fileName: 'alpha.sql', newName: 'beta' } });
        expect(values).toHaveLength(2);
    });

    it('renders a reader of the references of a script only when its report changes', () => {
        const workbook = rt.addWorkbook(CONNECTION, [['alpha.sql', 'select 1 as x'], ['beta.sql', 'select x from :alpha'], ['gamma.sql', 'select x from :alpha']]);
        const [, beta, gamma] = workbook.scriptKeys;
        const betaReport = probe<ScriptReferenceReport | null>();
        const gammaReport = probe<ScriptReferenceReport | null>();
        render(<>
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
    });

    it('follows the scripts of its workbook only', () => {
        const first = rt.addWorkbook(CONNECTION, [['alpha.sql', 'select 1'], ['beta.sql', 'select 2']]);
        const second = rt.addWorkbook(CONNECTION, [['other.sql', 'select 3']]);
        const map = probe<ScriptDataMap>();
        const names = probe<string>();
        render(<>
            <Probed probe={map} use={() => useWorkbookScriptMap(first.workbookId)} />
            <Probed probe={names} use={() => useWorkbookScriptsSelector(first.workbookId, selectFileNames)} />
        </>);
        expect(names.value).toBe('alpha.sql,beta.sql');

        // A change of a script of another workbook renders neither
        apply(second.workbookId, { kind: 'setScriptText', value: { scriptKey: second.scriptKeys[0], text: 'select 4', withDiff: false } });
        expect([map.renders, names.renders]).toEqual([1, 1]);

        // A change of the text renders the map, the selected names stay
        apply(first.workbookId, { kind: 'setScriptText', value: { scriptKey: first.scriptKeys[0], text: 'select 5', withDiff: false } });
        expect([map.renders, names.renders]).toEqual([2, 1]);

        // A created script is followed from then on
        apply(first.workbookId, { kind: 'createScript', value: { text: 'select 6', base: 'gamma' } });
        expect(names.value).toBe('alpha.sql,beta.sql,gamma.sql');
        const created = rt.store.get('workbook', first.workbookId)!.scriptKeys[2];
        const renders = map.renders;
        apply(first.workbookId, { kind: 'setScriptText', value: { scriptKey: created, text: 'select 7', withDiff: false } });
        expect(map.renders).toBe(renders + 1);
        expect(map.value?.[created]?.scriptSession.getText()).toBe('select 7');

        // A renamed script renders both
        apply(first.workbookId, { kind: 'renameScript', value: { fileName: 'beta.sql', newName: 'delta' } });
        expect(names.value).toBe('alpha.sql,delta.sql,gamma.sql');
        expect(map.value?.[first.scriptKeys[1]]?.fileName).toBe('delta.sql');
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
