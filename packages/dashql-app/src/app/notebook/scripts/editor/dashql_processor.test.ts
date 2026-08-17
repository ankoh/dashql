import * as dashql from '../../../../core/index.js';

import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import {
    analyzeScript,
    DashQLCompletionAbortEffect,
    DashQLCompletionStatus,
    DashQLProcessorPlugin,
    DashQLProcessorUpdateIn,
    DashQLUpdateEffect,
} from './dashql_processor.js';

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

describe('DashQL processor completion triggers', () => {
    it('does not start completion when deleting selected comments before a token', () => {
        const catalog = dql!.createCatalog();
        const text = `-- Fetch and visualize vega cars data from a parquet file, rendering a point
-- chart with year on the x-axis and weight on the y-axis.
SELECT * FROM read_parquet('vega_cars.parquet') VISUALIZE USING vegalite (
  mark => point,
  encoding => (
    x => (field => "Year", type => temporal),
    y => (field => "Weight_in_lbs", type => quantitative)
  )
);`;
        const cursorOffset = text.indexOf('VISUALIZE');
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, text);
        const scriptBuffers = analyzeScript(script);
        const scriptCursor = script.moveCursor(cursorOffset);
        expect(scriptCursor.read().scannerRelativePosition()).toBe(
            dashql.buffers.cursor.RelativeSymbolPosition.BEGIN_OF_SYMBOL,
        );
        expect(scriptCursor.read().scannerSymbolCompletable()).toBe(true);

        const processorState: DashQLProcessorUpdateIn = {
            scriptKey: 1,
            script,
            scriptBuffers,
            scriptCursor,
            scriptCompletion: null,
            scriptPendingDiff: null,
            derivedFocus: null,
            onUpdate: () => {},
        };
        let editorState = EditorState.create({
            doc: text,
            selection: EditorSelection.range(0, cursorOffset),
            extensions: [DashQLProcessorPlugin],
        });
        editorState = editorState.update({ effects: DashQLUpdateEffect.of(processorState) }).state;
        editorState = editorState.update({
            changes: { from: 0, to: cursorOffset },
            selection: EditorSelection.cursor(0),
            annotations: Transaction.userEvent.of('delete.selection'),
        }).state;

        expect(editorState.doc.toString()).toBe(text.slice(cursorOffset));
        expect(editorState.field(DashQLProcessorPlugin).scriptCompletion).toBeNull();
    });

    it('does not start completion when backspace deletes the newline before a token', () => {
        const catalog = dql!.createCatalog();
        const text = '\nSELECT';
        const cursorOffset = 1;
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, text);
        const scriptBuffers = analyzeScript(script);
        const scriptCursor = script.moveCursor(cursorOffset);
        expect(scriptCursor.read().scannerRelativePosition()).toBe(
            dashql.buffers.cursor.RelativeSymbolPosition.BEGIN_OF_SYMBOL,
        );
        expect(scriptCursor.read().scannerSymbolCompletable()).toBe(true);

        const processorState: DashQLProcessorUpdateIn = {
            scriptKey: 1,
            script,
            scriptBuffers,
            scriptCursor,
            scriptCompletion: null,
            scriptPendingDiff: null,
            derivedFocus: null,
            onUpdate: () => {},
        };
        let editorState = EditorState.create({
            doc: text,
            selection: EditorSelection.cursor(cursorOffset),
            extensions: [DashQLProcessorPlugin],
        });
        editorState = editorState.update({ effects: DashQLUpdateEffect.of(processorState) }).state;
        editorState = editorState.update({
            changes: { from: 0, to: 1 },
            selection: EditorSelection.cursor(0),
            annotations: Transaction.userEvent.of('delete.backward'),
        }).state;

        expect(editorState.doc.toString()).toBe('SELECT');
        expect(editorState.field(DashQLProcessorPlugin).scriptCompletion).toBeNull();
    });

    it('still starts completion when backspace deletes from a token', () => {
        const catalog = dql!.createCatalog();
        const text = 'SELECT';
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, text);
        const processorState: DashQLProcessorUpdateIn = {
            scriptKey: 1,
            script,
            scriptBuffers: analyzeScript(script),
            scriptCursor: script.moveCursor(text.length),
            scriptCompletion: null,
            scriptPendingDiff: null,
            derivedFocus: null,
            onUpdate: () => {},
        };
        let editorState = EditorState.create({
            doc: text,
            selection: EditorSelection.cursor(text.length),
            extensions: [DashQLProcessorPlugin],
        });
        editorState = editorState.update({ effects: DashQLUpdateEffect.of(processorState) }).state;
        editorState = editorState.update({
            changes: { from: text.length - 1, to: text.length },
            selection: EditorSelection.cursor(text.length - 1),
            annotations: Transaction.userEvent.of('delete.backward'),
        }).state;

        expect(editorState.doc.toString()).toBe('SELEC');
        expect(editorState.field(DashQLProcessorPlugin).scriptCompletion).not.toBeNull();
    });

    it('does not start completion when typing at the beginning of a token', () => {
        const catalog = dql!.createCatalog();
        const schemaScript = dql!.createScript(catalog);
        schemaScript.insertTextAt(0, 'create table tableA("attrA" int)');
        schemaScript.analyze();
        catalog.loadScript(schemaScript, 0);

        const text = 'select * from tableA where ttr';
        const cursorOffset = text.indexOf('ttr');
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, text);
        const scriptBuffers = analyzeScript(script);
        const scriptCursor = script.moveCursor(cursorOffset);
        expect(scriptCursor.read().scannerRelativePosition()).toBe(
            dashql.buffers.cursor.RelativeSymbolPosition.BEGIN_OF_SYMBOL,
        );
        expect(scriptCursor.read().scannerSymbolCompletable()).toBe(true);

        const processorState: DashQLProcessorUpdateIn = {
            scriptKey: 1,
            script,
            scriptBuffers,
            scriptCursor,
            scriptCompletion: null,
            scriptPendingDiff: null,
            derivedFocus: null,
            onUpdate: () => {},
        };
        let editorState = EditorState.create({
            doc: text,
            selection: EditorSelection.cursor(cursorOffset),
            extensions: [DashQLProcessorPlugin],
        });
        editorState = editorState.update({ effects: DashQLUpdateEffect.of(processorState) }).state;

        editorState = editorState.update({
            changes: { from: cursorOffset, insert: 'a' },
            selection: EditorSelection.cursor(cursorOffset + 1),
            annotations: Transaction.userEvent.of('input.type'),
        }).state;

        expect(editorState.doc.toString()).toBe('select * from tableA where attr');
        expect(editorState.field(DashQLProcessorPlugin).scriptCompletion).toBeNull();
    });

    it('does not start completion for composed input at the beginning of a token', () => {
        const catalog = dql!.createCatalog();
        const text = 'select ttr';
        const cursorOffset = text.indexOf('ttr');
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, text);
        const processorState: DashQLProcessorUpdateIn = {
            scriptKey: 1,
            script,
            scriptBuffers: analyzeScript(script),
            scriptCursor: script.moveCursor(cursorOffset),
            scriptCompletion: null,
            scriptPendingDiff: null,
            derivedFocus: null,
            onUpdate: () => {},
        };
        let editorState = EditorState.create({
            doc: text,
            selection: EditorSelection.cursor(cursorOffset),
            extensions: [DashQLProcessorPlugin],
        });
        editorState = editorState.update({ effects: DashQLUpdateEffect.of(processorState) }).state;
        editorState = editorState.update({
            changes: { from: cursorOffset, insert: 'a' },
            selection: EditorSelection.cursor(cursorOffset + 1),
            annotations: Transaction.userEvent.of('input.type.compose'),
        }).state;

        expect(editorState.field(DashQLProcessorPlugin).scriptCompletion).toBeNull();
    });

    it('dismisses an active completion when typing at the beginning of another token', () => {
        const catalog = dql!.createCatalog();
        const schemaScript = dql!.createScript(catalog);
        schemaScript.insertTextAt(0, 'create table tableA("attrA" int)');
        schemaScript.analyze();
        catalog.loadScript(schemaScript, 0);

        const text = 'select * from tableA where att ttr';
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, text);
        const scriptBuffers = analyzeScript(script);
        const firstCursor = text.indexOf('att') + 3;
        script.moveCursor(firstCursor).destroy();
        const completionBuffer = script.completeAtCursor(10);
        const processorState: DashQLProcessorUpdateIn = {
            scriptKey: 1,
            script,
            scriptBuffers,
            scriptCursor: script.moveCursor(firstCursor),
            scriptCompletion: {
                status: DashQLCompletionStatus.AVAILABLE,
                passiveHint: false,
                buffer: completionBuffer,
                candidateId: 0,
                candidatePatch: [],
                catalogObjectId: 0,
                catalogObjectPatch: [],
                catalogObjectCursorOffset: null,
            },
            scriptPendingDiff: null,
            derivedFocus: null,
            onUpdate: () => {},
        };
        let editorState = EditorState.create({
            doc: text,
            selection: EditorSelection.cursor(firstCursor),
            extensions: [DashQLProcessorPlugin],
        });
        editorState = editorState.update({ effects: DashQLUpdateEffect.of(processorState) }).state;
        expect(editorState.field(DashQLProcessorPlugin).scriptCompletion).not.toBeNull();

        const secondCursor = editorState.doc.toString().indexOf('ttr');
        editorState = editorState.update({ selection: EditorSelection.cursor(secondCursor) }).state;
        editorState = editorState.update({
            changes: { from: secondCursor, insert: 'a' },
            selection: EditorSelection.cursor(secondCursor + 1),
            annotations: Transaction.userEvent.of('input.type'),
        }).state;

        expect(editorState.field(DashQLProcessorPlugin).scriptCompletion).toBeNull();
    });

    it('does not restore a completion dismissed with Escape from a stale update', () => {
        const catalog = dql!.createCatalog();
        const schemaScript = dql!.createScript(catalog);
        schemaScript.insertTextAt(0, 'create table tableA("attrA" int)');
        schemaScript.analyze();
        catalog.loadScript(schemaScript, 0);

        const text = 'select * from tableA where att';
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, text);
        const scriptBuffers = analyzeScript(script);
        const processorState: DashQLProcessorUpdateIn = {
            scriptKey: 1,
            script,
            scriptBuffers,
            scriptCursor: script.moveCursor(text.length),
            scriptCompletion: null,
            scriptPendingDiff: null,
            derivedFocus: null,
            onUpdate: () => {},
        };
        let editorState = EditorState.create({
            doc: text,
            selection: EditorSelection.cursor(text.length),
            extensions: [DashQLProcessorPlugin],
        });
        editorState = editorState.update({ effects: DashQLUpdateEffect.of(processorState) }).state;
        editorState = editorState.update({
            changes: { from: text.length, insert: 'r' },
            selection: EditorSelection.cursor(text.length + 1),
            annotations: Transaction.userEvent.of('input.type'),
        }).state;

        const staleCompletion = editorState.field(DashQLProcessorPlugin).scriptCompletion;
        expect(staleCompletion).not.toBeNull();
        editorState = editorState.update({ effects: DashQLCompletionAbortEffect.of(null) }).state;
        expect(editorState.field(DashQLProcessorPlugin).scriptCompletion).toBeNull();

        const dismissedState = editorState.field(DashQLProcessorPlugin);
        editorState = editorState.update({
            effects: DashQLUpdateEffect.of({
                ...dismissedState,
                scriptCursor: script.moveCursor(text.length + 1),
                scriptCompletion: staleCompletion,
            }),
        }).state;

        expect(editorState.field(DashQLProcessorPlugin).scriptCompletion).toBeNull();
    });
});
