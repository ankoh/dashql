import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GenerationPlaceholder, setGenerationPlaceholder } from './generation_placeholder.js';

describe('Generation placeholder', () => {
    let view: EditorView;
    beforeEach(() => {
        view = new EditorView({
            state: EditorState.create({ doc: '-- how many rows' }),
            parent: document.body,
        });
    });
    afterEach(() => view.destroy());

    const placeholder = () => view.dom.querySelector('[role="status"]');

    it('shows one line after the script until it is hidden', () => {
        setGenerationPlaceholder(view, null);
        expect(view.state.field(GenerationPlaceholder, false)).toBeUndefined();
        expect(placeholder()).toBeNull();
        setGenerationPlaceholder(view, 'waiting for agent...');
        expect(view.dom.querySelectorAll('[role="status"]').length).toBe(1);
        expect(placeholder()?.previousElementSibling?.textContent).toBe('-- how many rows');
        setGenerationPlaceholder(view, null);
        expect(placeholder()).toBeNull();
        setGenerationPlaceholder(view, 'waiting for agent...');
        expect(view.dom.querySelectorAll('[role="status"]').length).toBe(1);
    });

    it('shows the latest status line', () => {
        setGenerationPlaceholder(view, 'dashql agent catalog');
        expect(placeholder()?.textContent).toBe('dashql agent catalog');
        setGenerationPlaceholder(view, 'dashql agent run q1');
        expect(view.dom.querySelectorAll('[role="status"]').length).toBe(1);
        expect(placeholder()?.textContent).toBe('dashql agent run q1');
    });

    it('stays at the end of the document', () => {
        setGenerationPlaceholder(view, 'waiting for agent...');
        view.dispatch({ changes: { from: view.state.doc.length, insert: '\n-- and per day' } });
        expect(placeholder()?.previousElementSibling?.textContent).toBe('-- and per day');
    });
});
