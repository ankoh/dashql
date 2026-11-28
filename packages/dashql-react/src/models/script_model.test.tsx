import * as React from 'react';
import { act } from '../testing/react_act.js';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import type { Runtime } from '@akohn/dashql/runtime';
import { createTestConnection } from '@akohn/dashql/runtime/testing/connection_fixtures';
import { createTestRuntime } from '@akohn/dashql/runtime/testing/test_runtime';

import { RuntimeContextProvider, useRuntime } from '../hooks.js';
import { useScriptModel, type ScriptModel } from './script_model.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const EMBEDDED = { hyper: { endpoint: '', protocol: 'WASM' } } as ConnectionParams;
const WORKBOOK = '33333333-3333-4333-8333-333333333333';

/// A workbook with a script with text and a blank one, the models of both
function Models(props: { capture: (runtime: Runtime, models: (ScriptModel | null)[]) => void }) {
    const runtime = useRuntime();
    const [keys, setKeys] = React.useState<number[] | null>(null);
    React.useEffect(() => {
        void createTestConnection(runtime, { connectionId: 'database', params: EMBEDDED });
        runtime.createWorkbook('database', null, false, undefined, WORKBOOK);
        runtime.dispatch({ workbook: WORKBOOK }, { kind: 'createScript', value: { text: 'select 1', base: 'text' } });
        runtime.dispatch({ workbook: WORKBOOK }, { kind: 'createScript', value: { text: '', base: 'blank' } });
        runtime.flush();
        setKeys(runtime.store.get('workbook', WORKBOOK)!.scriptKeys);
    }, [runtime]);
    const text = useScriptModel(WORKBOOK, keys?.[0]);
    const blank = useScriptModel(WORKBOOK, keys?.[1]);
    React.useLayoutEffect(() => props.capture(runtime, [text, blank]));
    return null;
}

describe('the model of a script', () => {
    it('stages a rewrite of a script with text as a diff, rewrites a blank script directly, and settles', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        let models: (ScriptModel | null)[] = [];
        const runtime: Runtime = await createTestRuntime();
        try {
            await act(async () => {
                root.render(<RuntimeContextProvider value={runtime}>
                    <Models capture={(_, current) => { models = current; }} />
                </RuntimeContextProvider>);
            });
            await vi.waitFor(() => expect(models.every(model => model != null)).toBe(true));
            const [text, blank] = models as ScriptModel[];
            expect(text.query).toBeNull();
            expect(text.runActive).toBe(false);

            // The operation resolves once the store shows the rewrite, the component renders with it right after
            const key = text.script.scriptKey;
            await act(async () => await text.setText('select 2'));
            expect(runtime.store.get('script', key)?.pendingDiff).not.toBeNull();
            await vi.waitFor(() => expect(models[0]!.script.pendingDiff).not.toBeNull());
            expect(models[0]!.script.scriptSession.getText()).toBe('select 2');
            await act(async () => await models[0]!.rejectDiff());
            expect(runtime.store.get('script', key)?.pendingDiff).toBeNull();
            await vi.waitFor(() => expect(models[0]!.script.pendingDiff).toBeNull());
            expect(models[0]!.script.scriptSession.getText()).toBe('select 1');
            // A new model of the changed script keeps the operations
            expect(models[0]).not.toBe(text);
            for (const operation of ['run', 'cancel', 'setText', 'acceptDiff', 'rejectDiff', 'setVisSpec'] as const) {
                expect(models[0]![operation]).toBe(text[operation]);
            }

            // A blank script has nothing to keep, the snippet replaces it
            await act(async () => await blank.setText('select 3'));
            await vi.waitFor(() => expect(models[1]!.script.scriptSession.getText()).toBe('select 3'));
            expect(models[1]!.script.pendingDiff).toBeNull();

            // A script that runs nothing has nothing to cancel
            await act(async () => await models[1]!.cancel());
        } finally {
            act(() => root.unmount());
            container.remove();
            await runtime.destroy();
        }
    });
});
