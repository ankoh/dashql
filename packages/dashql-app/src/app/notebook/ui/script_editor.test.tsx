import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const state = vi.hoisted(() => ({ codeMirrorProps: null as any }));
vi.mock('../scripts/editor/codemirror.js', async () => {
    const React = await import('react');
    return {
        createCodeMirrorExtensions: () => [],
        CodeMirror: React.forwardRef((_props: any, _ref) => {
            state.codeMirrorProps = _props;
            return React.createElement('div', { 'data-testid': 'codemirror' });
        }),
    };
});
vi.mock('../scripts/notebook_scripts_registry.js', () => ({
    useNotebookScripts: () => [{
        scripts: {
            7: {
                scriptKey: 7,
                scriptSession: { getText: () => 'SELECT\n    1;' },
            },
        },
    }, vi.fn()],
}));
vi.mock('../../config/app_config.js', () => ({ useAppConfig: () => ({ settings: {} }) }));
vi.mock('../../../platform/logger/logger_provider.js', () => ({ useLogger: () => ({ debug: vi.fn() }) }));

import { ScriptEditor } from './script_editor.js';

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
        act(() => root.render(<ScriptEditor notebookId="notebook" scriptKey={7} autoHeight />));

        expect(state.codeMirrorProps.initialDoc).toBe('SELECT\n    1;');
        expect(state.codeMirrorProps.style).toEqual({ height: 'auto' });
    });
});
