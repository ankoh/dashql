import { tql } from '@tigon/proto';
import monaco, { Monaco } from '../monaco-editor';
import * as Store from '../store';
import { CoreController } from './core';
import { isPresent } from '../util/functional';

export class EditorController {
    protected store: Store.ReduxStore;
    protected core: CoreController;

    private editor?: Monaco.editor.IStandaloneCodeEditor;

    constructor(store: Store.ReduxStore, core: CoreController) {
        this.store = store;
        this.core = core;
    }

    public registerEditor(editor: Monaco.editor.IStandaloneCodeEditor) {
        this.editor = editor;
    }

    public async evaluate(input: string) {
        await this.core.waitUntilReady();

        const session = await this.core.createSession();
        const module = await this.core.parseTQL(session, input);

        this.displayErrors(module.getErrorsList());
        this.store.dispatch(Store.setTQLModule(module));
    }

    public displayErrors(errors: tql.Error[]) {
        const model = this.editor?.getModel();

        if (!model) {
            return;
        }

        const markers = errors
            .map(error => {
                const location = error.getLocation();
                const begin = location?.getBegin();
                const startLineNumber = begin?.getLine();
                const startColumn = begin?.getColumn();
                const end = location?.getEnd();
                const endLineNumber = end?.getLine();
                const endColumn = end?.getColumn();

                if (
                    !startLineNumber ||
                    !startColumn ||
                    !endLineNumber ||
                    !endColumn
                ) {
                    return undefined;
                }

                const message = error.getMessage();

                return {
                    startLineNumber,
                    startColumn,
                    endLineNumber,
                    endColumn,
                    message,
                    severity: monaco.MarkerSeverity.Error,
                };
            })
            .filter(isPresent);

        monaco.editor.setModelMarkers(model, 'TQL', markers);
    }

    public replace(location: tql.Location, text: string | null) {
        const editor = this.editor;

        if (!editor) {
            return;
        }

        const model = editor.getModel();

        if (!model) {
            return;
        }

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
                (model.getLineLength(nextCharacterRange.endLineNumber) ?? 0) + 1
            ) {
                nextCharacterRange.endLineNumber += 1;
                nextCharacterRange.endColumn = 1;
            } else {
                nextCharacterRange.endColumn += 1;
            }

            const nextCharacter = model.getValueInRange(nextCharacterRange);

            if (nextCharacter != '\n') {
                break;
            } else {
                range.endLineNumber = nextCharacterRange.endLineNumber;
                range.endColumn = nextCharacterRange.endColumn;
            }
        }

        let paddedText = text;

        if (paddedText != null) {
            if (!(range.endLineNumber == 1 && range.endColumn == 1)) {
                paddedText = '\n\n' + paddedText;
            }

            if (
                range.endLineNumber == model.getLineCount() &&
                range.endColumn == model.getLineLength(range.endLineNumber) + 1
            ) {
                paddedText = paddedText + '\n';
            } else if (
                range.endColumn == 1 ||
                range.endColumn == model.getLineLength(range.endLineNumber) + 1
            ) {
                paddedText = paddedText + '\n\n';
            }
        }

        editor.executeEdits(
            '',
            [
                {
                    range: range as Monaco.Range,
                    text: paddedText,
                },
            ],
            [
                monaco.Selection.fromPositions(
                    {
                        lineNumber: 1,
                        column: 1,
                    },
                    {
                        lineNumber: 1,
                        column: 1,
                    },
                ),
            ],
        );
    }
}

export default EditorController;
