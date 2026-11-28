import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { act } from '@akohn/dashql-react/testing/react_act';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { SqlKeyBar } from './sql_key_bar.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('SqlKeyBar', () => {
    let root: ReturnType<typeof createTestRoot>;
    let view: EditorView;
    beforeEach(() => {
        root = createTestRoot();
        view = new EditorView({ state: EditorState.create({ doc: 'select count(1) from t', selection: { anchor: 6 } }), parent: document.body });
    });
    afterEach(() => {
        root.unmount();
        view.destroy();
    });
    const key = (label: string) => [...root.container.querySelectorAll<HTMLButtonElement>('[data-testid="sql-key-bar"] button')]
        .find(button => button.textContent === label)!;

    it('types the symbols of SQL at the cursor and moves the cursor', () => {
        root.render(<SqlKeyBar editor={view} />);
        act(() => key('*').click());
        expect(view.state.doc.toString()).toBe('select* count(1) from t');
        act(() => key('←').click());
        act(() => key(';').click());
        expect(view.state.doc.toString()).toBe('select;* count(1) from t');
        act(() => key('→').click());
        expect(view.state.selection.main.head).toBe(8);
        // Without a run the bar has no Run
        expect(root.container.querySelector('[data-testid="sql-key-run"]')).toBeNull();
    });

    it('runs the script', () => {
        const onRun = vi.fn();
        root.render(<SqlKeyBar editor={view} onRun={onRun} />);
        act(() => key('Run').click());
        expect(onRun).toHaveBeenCalledOnce();
    });
});
