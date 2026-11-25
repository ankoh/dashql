import * as dashql from '@akohn/dashql';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ORDERS_COMPLETION_TEXT, ordersCompletion } from '../../../tests/mocks/editor_completion.js';
import { DashQLCompletionListenerPlugin } from './dashql_completion_listener.js';
import { DashQLCompletionSelectCandidateEffect, DashQLProcessorPlugin, DashQLUpdateEffect } from '../dashql_processor.js';
import { DashQLCompletionStatus } from './dashql_completion_state.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

describe('DashQL completion keys', () => {
    let view: EditorView | null = null;
    let parent: HTMLElement | null = null;
    afterEach(() => {
        view?.destroy();
        parent?.remove();
        view = null;
        dql.resetUnsafe();
    });

    /// An editor at the end of the text, completing the orders tables if asked to
    function editor(complete: boolean): EditorView {
        parent = document.createElement('div');
        document.body.appendChild(parent);
        view = new EditorView({
            parent,
            state: EditorState.create({
                doc: ORDERS_COMPLETION_TEXT,
                selection: EditorSelection.cursor(ORDERS_COMPLETION_TEXT.length),
                extensions: [DashQLProcessorPlugin, DashQLCompletionListenerPlugin],
            }),
        });
        if (complete) view.dispatch({ effects: DashQLUpdateEffect.of(ordersCompletion(dql)) });
        return view;
    }
    const press = (target: EditorView, key: string, ctrlKey = false) =>
        runScopeHandlers(target, new KeyboardEvent('keydown', { key, ctrlKey }), 'editor');
    const pressTab = (target: EditorView) => press(target, 'Tab');
    const completion = (target: EditorView) => target.state.field(DashQLProcessorPlugin).scriptCompletion;
    const status = (target: EditorView) => target.state.field(DashQLProcessorPlugin).scriptCompletion?.status;

    it('completes a table of a non-default database with its qualification', () => {
        const target = editor(true);
        expect(pressTab(target)).toBe(true);
        expect(target.state.doc.toString()).toBe('select * from db0.public.orders');
        expect(target.state.selection.main.anchor).toBe(target.state.doc.length);
        expect(status(target)).toBe(DashQLCompletionStatus.SELECTED_CATALOG_OBJECT);

        // A completed catalog object leaves Tab to the indentation
        expect(pressTab(target)).toBe(true);
        expect(target.state.doc.toString()).toBe('select * from db0.public.orders\t');
    });

    it('qualifies a selected candidate with its catalog object', () => {
        const target = editor(true);
        target.dispatch({ effects: DashQLCompletionSelectCandidateEffect.of(null) });
        expect(status(target)).toBe(DashQLCompletionStatus.SELECTED_CANDIDATE);
        expect(pressTab(target)).toBe(true);
        expect(target.state.doc.toString()).toMatch(/db[01]\.public\./);
        expect(status(target)).toBe(DashQLCompletionStatus.SELECTED_CATALOG_OBJECT);
    });

    it('indents without a completion', () => {
        const target = editor(false);
        expect(pressTab(target)).toBe(true);
        expect(target.state.doc.toString()).toBe(`${ORDERS_COMPLETION_TEXT}\t`);
    });

    it('moves through the candidates and catalog objects with the arrow keys', () => {
        const target = editor(true);
        const candidateId = completion(target)!.candidateId;
        expect(press(target, 'ArrowDown')).toBe(true);
        expect(completion(target)!.candidateId).not.toBe(candidateId);
        expect(press(target, 'ArrowUp')).toBe(true);
        expect(completion(target)!.candidateId).toBe(candidateId);

        const catalogObjectId = completion(target)!.catalogObjectId;
        expect(press(target, 'ArrowRight')).toBe(true);
        expect(completion(target)!.catalogObjectId).not.toBe(catalogObjectId);
        expect(press(target, 'ArrowLeft')).toBe(true);
        expect(completion(target)!.catalogObjectId).toBe(catalogObjectId);
    });

    it('moves through the candidates with Ctrl-N and Ctrl-P', () => {
        const target = editor(true);
        const candidateId = completion(target)!.candidateId;
        expect(press(target, 'n', true)).toBe(true);
        expect(completion(target)!.candidateId).not.toBe(candidateId);
        expect(press(target, 'p', true)).toBe(true);
        expect(completion(target)!.candidateId).toBe(candidateId);
        expect(target.state.doc.toString()).toBe(ORDERS_COMPLETION_TEXT);
    });

    it('leaves Enter to the editor until the user steps through the list', () => {
        const target = editor(true);
        expect(press(target, 'Enter')).toBe(false);
        expect(target.state.doc.toString()).toBe(ORDERS_COMPLETION_TEXT);
        expect(status(target)).toBe(DashQLCompletionStatus.AVAILABLE);
    });

    it('accepts the candidate with Enter after the arrow keys', () => {
        const target = editor(true);
        expect(press(target, 'ArrowDown')).toBe(true);
        expect(press(target, 'ArrowUp')).toBe(true);
        expect(press(target, 'Enter')).toBe(true);
        // Like Tab, with the qualification of a table of another database
        expect(target.state.doc.toString()).toBe('select * from db0.public.orders');
        expect(target.state.selection.main.anchor).toBe(target.state.doc.length);
        expect(status(target)).toBe(DashQLCompletionStatus.SELECTED_CATALOG_OBJECT);
        // The next Enter is the editor's again
        expect(press(target, 'Enter')).toBe(false);
    });

    it('accepts the candidate with Enter after Ctrl-N', () => {
        const target = editor(true);
        expect(press(target, 'n', true)).toBe(true);
        const candidate = completion(target)!.buffer.read().candidates(completion(target)!.candidateId)!;
        expect(press(target, 'Enter')).toBe(true);
        expect(target.state.doc.toString()).toContain(candidate.completionText()!);
        expect(status(target)).not.toBe(DashQLCompletionStatus.AVAILABLE);
    });

    it('aborts the completion with Escape', () => {
        const target = editor(true);
        expect(press(target, 'Escape')).toBe(true);
        expect(status(target)).not.toBe(DashQLCompletionStatus.AVAILABLE);
        expect(press(target, 'Escape')).toBe(false);
    });

    it('leaves the arrow keys to the editor without a completion', () => {
        const target = editor(false);
        for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter']) expect(press(target, key)).toBe(false);
        for (const key of ['n', 'p']) expect(press(target, key, true)).toBe(false);
    });
});

