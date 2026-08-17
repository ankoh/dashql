import * as dashql from '../../../../core/index.js';

import { EditorState } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';

import { buildDecorationsForRanges, commentTag } from './dashql_decorations_standalone.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => dql!.resetUnsafe());

describe('scanner decorations', () => {
    it('highlights comments from the separate comment spans', () => {
        const text = '-- leading comment\nselect /* middle comment */ 1';
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, text);
        script.analyze();
        const parsed = script.getParsed();
        const state = EditorState.create({
            doc: text,
            extensions: syntaxHighlighting(HighlightStyle.define([{ tag: commentTag, class: 'comment' }])),
        });

        const ranges: Array<{ from: number; to: number }> = [];
        buildDecorationsForRanges(state, parsed, [{ from: 0, to: text.length }]).between(
            0,
            text.length,
            (from, to, value) => {
                if (value.spec.class === 'comment') ranges.push({ from, to });
            },
        );

        expect(ranges).toEqual([
            { from: 0, to: '-- leading comment'.length },
            { from: text.indexOf('/*'), to: text.indexOf('*/') + 2 },
        ]);
        parsed.destroy();
        script.destroy();
        catalog.destroy();
    });
});
