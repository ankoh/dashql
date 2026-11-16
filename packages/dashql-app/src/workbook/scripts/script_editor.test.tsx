import * as React from 'react';
import { act, waitForRender } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { DashQLProcessorPlugin } from '../editor/dashql_processor.js';
import { ScriptEditor, type ScriptEditorDependencies } from './script_editor.js';
import { RuntimeContextProvider } from '../../runtime/runtime_hooks.js';
import type { Runtime } from '@akohn/dashql/runtime/runtime';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = { codeMirrorProps: null as any };
const dependencies = {
    createCodeMirrorExtensions: () => [],
    CodeMirror: React.forwardRef((props: any, _ref) => {
        state.codeMirrorProps = props;
        return <div data-testid="codemirror" />;
    }),
    useWorkbook: () => ({
        workbookId: 'workbook',
        scriptKeys: [7],
        scriptRefs: { 'query.sql': { scriptId: 7, fileName: 'query.sql' } },
        scriptOrder: ['query.sql'],
    }),
    useScript: () => ({
        scriptKey: 7,
        workbookId: 'workbook',
        fileName: 'query.sql',
        scriptSession: { getText: () => 'SELECT\n    1;' },
        connectionId: 'main',
    }),
    useWorkbookDerived: () => null,
    useAppConfig: () => ({ settings: {} }),
    useLogger: () => ({ debug: vi.fn() }),
} as unknown as ScriptEditorDependencies;

describe('ScriptEditor', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        state.codeMirrorProps = null;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('seeds CodeMirror with the loaded script before its first layout', () => {
        act(() => root.render(<ScriptEditor workbookId="workbook" scriptKey={7} autoHeight dependencies={dependencies} />));

        expect(state.codeMirrorProps.initialDoc).toBe('SELECT\n    1;');
        expect(state.codeMirrorProps.style).toEqual({ height: 'auto' });
    });

    it('tells the runtime which script it shows, the runtime analyzes it when it is outdated', () => {
        const dispatch = vi.fn(() => ({ ok: true, changed: false, error: null, id: null }));
        const runtime = { dispatch } as unknown as Runtime;
        act(() => root.render(
            <RuntimeContextProvider value={runtime}>
                <ScriptEditor workbookId="workbook" scriptKey={7} dependencies={dependencies} />
            </RuntimeContextProvider>,
        ));
        const shown = dispatch.mock.calls.filter(call => (call as unknown[])[1] != null && ((call as unknown[])[1] as { kind: string }).kind === 'showScript');
        expect(shown).toHaveLength(1);
        const [target, action] = shown[0] as unknown as [unknown, { value: { scriptKey: number; selected: boolean } }];
        expect(target).toEqual({ workbook: 'workbook' });
        expect(action.value.scriptKey).toBe(7);
        dispatch.mockClear();
        act(() => root.render(<div />));
        expect(dispatch).toHaveBeenCalledWith({ workbook: 'workbook' }, { kind: 'hideScript', value: action.value });
    });

    describe('line wrapping', () => {
        const scriptSession = { getText: () => 'SELECT 1;', getTextVersion: () => 0 };
        const realViewDependencies = {
            ...dependencies,
            createCodeMirrorExtensions: () => [DashQLProcessorPlugin],
            CodeMirror: React.forwardRef<EditorView, any>((props, ref) => {
                const [node, setNode] = React.useState<HTMLDivElement | null>(null);
                React.useEffect(() => {
                    if (node == null) return;
                    const view = new EditorView({
                        state: EditorState.create({ doc: props.initialDoc, extensions: [DashQLProcessorPlugin, ...(props.extraExtensions ?? [])] }),
                        parent: node,
                    });
                    (ref as (view: EditorView) => void)(view);
                    return () => view.destroy();
                }, [node]);
                return <div ref={setNode} />;
            }),
            useWorkbook: () => ({
                workbookId: 'workbook',
                scriptKeys: [7],
                scriptRefs: { 'query.sql': { scriptId: 7, fileName: 'query.sql' } },
                scriptOrder: ['query.sql'],
            }),
            useScript: () => ({ scriptKey: 7, workbookId: 'workbook', fileName: 'query.sql', scriptSession, connectionId: 'main' }),
        } as unknown as ScriptEditorDependencies;

        async function renderBoundEditor(props: { lineWrapping?: boolean }): Promise<EditorView> {
            let view: EditorView | null = null;
            act(() => root.render(<ScriptEditor workbookId="workbook" scriptKey={7} autoHeight setView={v => { view = v; }} dependencies={realViewDependencies} {...props} />));
            // Binding the script replaced the state the view was mounted with
            await waitForRender(() => expect(view!.state.field(DashQLProcessorPlugin).scriptSession).toBe(scriptSession));
            return view!;
        }

        it('keeps wrapping after binding the script replaced the editor state', async () => {
            const view = await renderBoundEditor({ lineWrapping: true });
            expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
        });

        it('does not wrap unless asked to', async () => {
            const view = await renderBoundEditor({});
            expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false);
        });
    });
});
