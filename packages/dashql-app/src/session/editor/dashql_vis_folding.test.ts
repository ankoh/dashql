import * as dashql from '@ankoh/dashql-core';

import { foldedRanges, unfoldEffect } from '@codemirror/language';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { DashQLGutterPlugin } from './dashql_gutters.js';
import { DashQLProcessorPlugin, DashQLProcessorUpdateIn, DashQLUpdateEffect } from './dashql_processor.js';
import { DashQLVisFoldingPlugin, findVegaLiteSpecs } from './dashql_vis_folding.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await dashql.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(() => {
    dql!.resetUnsafe();
});

const SPEC = '/* @vis vegalite\n   {\n     "mark": "bar",\n     "title": "a } b"\n   }\n*/\nselect 1 as a';
const SPEC_BODY = '\n     "mark": "bar",\n     "title": "a } b"\n   ';

/// A read-only projection of a text, like the views of the feed
function project(text: string): DashQLProcessorUpdateIn {
    const scriptSession = dql!.createScriptSession(dql!.createCatalog());
    scriptSession.replaceText(0n, text);
    const editorUpdate = scriptSession.analyze();
    scriptSession.destroy();
    return {
        scriptKey: 0,
        scriptSession: null,
        editorUpdate,
        scriptBuffers: null,
        scriptCompletion: null,
        scriptPendingDiff: null,
        derivedFocus: null,
        onUpdate: () => { },
    };
}

function folds(state: EditorState): string[] {
    const texts: string[] = [];
    foldedRanges(state).between(0, state.doc.length, (from, to) => { texts.push(state.doc.sliceString(from, to)); });
    return texts;
}

function replaceText(state: EditorState, text: string, userEvent?: string): EditorState {
    return state.update({
        changes: { from: 0, to: state.doc.length, insert: text },
        selection: EditorSelection.cursor(0),
        effects: DashQLUpdateEffect.of(project(text)),
        annotations: userEvent == null ? [] : Transaction.userEvent.of(userEvent),
    }).state;
}

function createState(text: string): EditorState {
    const state = EditorState.create({
        doc: '',
        selection: EditorSelection.cursor(0),
        extensions: [DashQLProcessorPlugin, DashQLVisFoldingPlugin, DashQLGutterPlugin],
    });
    return replaceText(state, text);
}

describe('Vega-Lite spec folding', () => {
    it('finds the specs between their braces', () => {
        const state = createState(SPEC);
        const specs = findVegaLiteSpecs(state.field(DashQLProcessorPlugin).editorUpdate);
        expect(specs.map(spec => state.doc.sliceString(spec.from, spec.to))).toEqual([SPEC_BODY]);
    });

    it('ignores other tags and empty specs', () => {
        const state = createState('/* @vis vegalite {} */ select 1;\n/* @vis table */ select 2;\n-- {"mark": "bar"}\nselect 3');
        expect(findVegaLiteSpecs(state.field(DashQLProcessorPlugin).editorUpdate)).toEqual([]);
    });

    it('folds the specs of a script that is opened', () => {
        expect(folds(createState(SPEC))).toEqual([SPEC_BODY]);
        expect(folds(createState('-- @vis vegalite {"mark":"bar"}\n-- @end\nselect 1 as a'))).toEqual(['"mark":"bar"']);
    });

    it('folds a spec that a script gets from outside', () => {
        const state = replaceText(createState('select 1 as a'), SPEC);
        expect(folds(state)).toEqual([SPEC_BODY]);
    });

    it('keeps a spec open that the user types', () => {
        const state = replaceText(createState('select 1 as a'), SPEC, 'input.paste');
        expect(folds(state)).toEqual([]);
    });

    it('folds and unfolds a spec from the gutter', () => {
        const view = new EditorView({ state: createState(SPEC), parent: document.body });
        try {
            // The gutter sizes itself with a hidden spacer marker
            const marker = () => {
                const markers = Array.from(view.dom.querySelectorAll<HTMLElement>('[data-testid="vis-fold-marker"]'))
                    .filter(marker => marker.closest<HTMLElement>('.cm-gutterElement')?.style.visibility !== 'hidden');
                expect(markers.length).toBe(1);
                return markers[0];
            };
            const click = () => {
                const rect = marker().getBoundingClientRect();
                const position = { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
                marker().dispatchEvent(new MouseEvent('click', position));
            };
            expect(folds(view.state)).toEqual([SPEC_BODY]);
            expect(marker().getAttribute('aria-expanded')).toBe('false');
            click();
            expect(folds(view.state)).toEqual([]);
            expect(marker().getAttribute('aria-expanded')).toBe('true');
            click();
            expect(folds(view.state)).toEqual([SPEC_BODY]);
        } finally {
            view.destroy();
        }
    });

    it('keeps a spec open that the user unfolded', () => {
        let state = createState(SPEC);
        const [spec] = findVegaLiteSpecs(state.field(DashQLProcessorPlugin).editorUpdate);
        state = state.update({ effects: unfoldEffect.of(spec) }).state;
        // The query changes but the spec stays the same
        state = replaceText(state, SPEC.replace('select 1', 'select 2'));
        expect(folds(state)).toEqual([]);
        // A new spec is folded again
        state = replaceText(state, SPEC.replace('"bar"', '"line"'));
        expect(folds(state)).toEqual([SPEC_BODY.replace('"bar"', '"line"')]);
    });
});
