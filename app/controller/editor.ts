import type * as monaco from 'monaco-editor';
import { tql } from '@tigon/proto';
import * as Store from '../store';
import { CoreController } from './core';

export class EditorController {
    protected store: Store.ReduxStore;
    protected core: CoreController;

    private editor?: monaco.editor.IStandaloneCodeEditor;

    constructor(store: Store.ReduxStore, core: CoreController) {
        this.store = store;
        this.core = core;
    }

    public registerEditor(editor: monaco.editor.IStandaloneCodeEditor) {
        this.editor = editor;
    }

    public async evaluate(input: string) {
        await this.core.waitUntilReady();

        const session = await this.core.createSession();
        const module = await this.core.parseTQL(session, input);

        this.store.dispatch(Store.setTQLModule(module));
    }

    public replace(location: tql.Location, text: string | null) {
        const model = this.editor?.getModel();

        const begin = location.getBegin();
        const end = location.getEnd();

        const range = {
            startLineNumber: begin?.getLine() ?? 1,
            startColumn: begin?.getColumn() ?? 1,
            endLineNumber: end?.getLine() ?? 1,
            endColumn: end?.getColumn() ?? 1,
        };

        while (true) {
            const nextCharacterRange = {
                startLineNumber: range.endLineNumber,
                startColumn: range.endColumn,
                endLineNumber: range.endLineNumber,
                endColumn: range.endColumn,
            };

            if (
                nextCharacterRange.endColumn ==
                (model?.getLineLength(nextCharacterRange.endLineNumber) ?? 0) +
                    1
            ) {
                nextCharacterRange.endLineNumber += 1;
                nextCharacterRange.endColumn = 1;
            } else {
                nextCharacterRange.endColumn += 1;
            }

            const nextCharacter = model?.getValueInRange(nextCharacterRange);

            if (nextCharacter != '\n') {
                break;
            } else {
                range.endLineNumber = nextCharacterRange.endLineNumber;
                range.endColumn = nextCharacterRange.endColumn;
            }
        }

        this.editor?.executeEdits('', [
            {
                range: range as monaco.Range,
                text,
            },
        ]);
    }
}

export default EditorController;
