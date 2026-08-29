import * as core from '../../../../core/index.js';

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

import { createStoryDecorations, DashQLStoryToggleStatementEffect, DashQLStoryUpdateEffect } from './dashql_story_decorations.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL | null = null;
beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => dql!.resetUnsafe());

function parseDescriptions(text: string): core.buffers.editor.EditorUpdateT {
    const catalog = dql!.createCatalog();
    const session = dql!.createScriptSession(catalog);
    session.replaceText(0n, text);
    const update = session.ensureAnalysis();
    session.destroy();
    catalog.destroy();
    return update;
}

describe('DashQL story decorations', () => {
    it('collapses documented SQL and toggles it independently', () => {
        const update = parseDescriptions('-- summary\nselect 1;');
        const { extensions, field } = createStoryDecorations({ activation: 'toggle' });
        let state = EditorState.create({ doc: '-- summary\nselect 1;', extensions });
        state = state.update({ effects: DashQLStoryUpdateEffect.of(update) }).state;
        expect(state.field(field).atomicRanges.size).toBeGreaterThan(0);

        state = state.update({ effects: DashQLStoryToggleStatementEffect.of(0) }).state;
        expect(state.field(field).atomicRanges.size).toBe(0);

        state = state.update({ effects: DashQLStoryToggleStatementEffect.of(0) }).state;
        expect(state.field(field).atomicRanges.size).toBeGreaterThan(0);
    });

    it('stays expanded until a documented story model is supplied', () => {
        const update = parseDescriptions('-- summary\nselect 1;');
        const { extensions, field } = createStoryDecorations({ activation: 'toggle' });
        let state = EditorState.create({ doc: '-- summary\nselect 1;', extensions });

        state = state.update({ effects: DashQLStoryUpdateEffect.of(null) }).state;
        expect(state.field(field).atomicRanges.size).toBe(0);

        state = state.update({ effects: DashQLStoryUpdateEffect.of(update) }).state;
        expect(state.field(field).atomicRanges.size).toBeGreaterThan(0);
    });

    it('renders a named native control for overview activation', () => {
        const onActivate = vi.fn();
        const update = parseDescriptions('-- summary\nselect 1;');
        const { extensions, field } = createStoryDecorations({ activation: 'open', onActivate, showGutter: false });
        const parent = document.createElement('div');
        const view = new EditorView({
            state: EditorState.create({ doc: '-- summary\nselect 1;', extensions }),
            parent,
        });
        view.dispatch({ effects: DashQLStoryUpdateEffect.of(update) });
        const button = parent.querySelector<HTMLButtonElement>('[data-dashql-story-control]');
        expect(button?.tagName).toBe('BUTTON');
        expect(button?.textContent).toBe('select statement');
        button?.click();
        expect(onActivate).toHaveBeenCalledWith(0);
        view.destroy();
    });

    it('expands a collapsed statement when its bean is activated', () => {
        const { extensions, field } = createStoryDecorations({ activation: 'toggle' });
        const update = parseDescriptions('-- summary\nselect 1;');
        const parent = document.createElement('div');
        const view = new EditorView({
            state: EditorState.create({ doc: '-- summary\nselect 1;', extensions }),
            parent,
        });
        view.dispatch({ effects: DashQLStoryUpdateEffect.of(update) });
        parent.querySelector<HTMLButtonElement>('[data-dashql-story-control]')?.click();
        expect(view.state.field(field).atomicRanges.size).toBe(0);
        view.destroy();
    });
});
