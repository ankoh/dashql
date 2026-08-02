import * as dashql from '../../core/index.js';

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
    DashQLDiffDecorationUpdateEffect,
    DashQLStandaloneDiffDecorationPlugin,
} from './dashql_diff_decorations.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => dql!.resetUnsafe());

describe('DashQL diff decorations', () => {
    it('highlights a generated description comment when the SQL statement is unchanged', () => {
        const priorText = 'select current_timestamp';
        const targetText = '-- Retrieves the current timestamp.\nselect current_timestamp';
        const catalog = dql!.createCatalog();
        const prior = dql!.createScript(catalog);
        const target = dql!.createScript(catalog);
        prior.insertTextAt(0, priorText);
        prior.parse();
        target.insertTextAt(0, targetText);
        target.parse();
        const diffBuffer = prior.computeDiff(target);
        const parent = document.createElement('div');
        const view = new EditorView({
            state: EditorState.create({ doc: targetText, extensions: DashQLStandaloneDiffDecorationPlugin }),
            parent,
        });

        view.dispatch({
            effects: DashQLDiffDecorationUpdateEffect.of({ priorText, diffBuffer }),
        });

        expect(parent.querySelector('.cm-dashql-diff-change')?.textContent).toBe('-- Retrieves the current timestamp.');
        view.destroy();
        diffBuffer.destroy();
        prior.destroy();
        target.destroy();
        catalog.destroy();
    });
});
