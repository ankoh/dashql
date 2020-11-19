import * as monaco from 'monaco-editor';
import { AppReduxStore, AppStateMutations } from '../store';
import { ParserController } from './parser';
import * as core from '@dashql/core';

export class EditorController {
    /// The editor
    protected _editor: monaco.editor.IStandaloneCodeEditor | null;
    /// The store
    protected _store: AppReduxStore;
    /// The parser
    protected _parser: ParserController;

    /// Constructor
    constructor(store: AppReduxStore, parser: ParserController) {
        this._store = store;
        this._editor = null;
        this._parser = parser;

        let previousEditorText = "";

        this._store.subscribe(() => {
            const { editorText } = this._store.getState();

            if (editorText != previousEditorText) {
                previousEditorText = editorText;
                this.evaluate(editorText);
            }
        });
    }

    public registerEditor(editor: monaco.editor.IStandaloneCodeEditor) {
        this._editor = editor;
    }

    /// Evaluate an editor
    public evaluate(input: string) {
        const m = this._parser.parse(input);
        this.displayErrors(m.buffer);
        this._store.dispatch(AppStateMutations.setEditorProgram(m));
    }

    /// Display module errors
    protected displayErrors(module: core.proto.syntax.Program): void {
        const model = this._editor?.getModel();
        if (!model) {
            return;
        }
        const markers = new Array<monaco.editor.IMarkerData>();
        for (let i = 0; i < module.errorsLength(); ++i) {
            const error = module.errors(i)!;
            const location = error.location()!;
            const begin = model.getPositionAt(location.offset());
            const startLineNumber = begin.lineNumber;
            const startColumn = begin.column;
            const end = model.getPositionAt(location.offset() + location.length());
            const endLineNumber = end.lineNumber;
            const endColumn = end.column;
            if (!startLineNumber || !startColumn || !endLineNumber || !endColumn) {
                return undefined;
            }
            markers.push({
                startLineNumber,
                startColumn,
                endLineNumber,
                endColumn,
                message: error.message() ?? "",
                severity: monaco.MarkerSeverity.Error,
            });
        }
        monaco.editor.setModelMarkers(model, 'DashQL', markers);
    }

    public replace(location: core.proto.syntax.Location, text: string | null) {
        /// Get monaco editor
        const editor = this._editor;
        if (!editor) {
            return;
        }

        /// Get monaco model
        const model = editor.getModel();
        if (!model) {
            return;
        }

        // Determine edit range
        const begin = model.getPositionAt(location.offset());
        const end = model.getPositionAt(location.offset() + location.length());
        const range = {
            startLineNumber: begin.lineNumber,
            startColumn: begin.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
        };
        while (true) {
            const nextCharacterRange = {
                startLineNumber: range.endLineNumber,
                startColumn: range.endColumn,
                endLineNumber: range.endLineNumber,
                endColumn: range.endColumn,
            };

            if (nextCharacterRange.endColumn == (model.getLineLength(nextCharacterRange.endLineNumber) ?? 0) + 1) {
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

        // Pad text with newlines
        let paddedText = text;
        if (paddedText != null) {
            if (!(range.endLineNumber == 1 && range.endColumn == 1)) {
                paddedText = '\n\n' + paddedText;
            }
            if (range.endLineNumber == model.getLineCount() &&
                range.endColumn == model.getLineLength(range.endLineNumber) + 1) {
                paddedText = paddedText + '\n';
            } else if (range.endColumn == 1 || range.endColumn == model.getLineLength(range.endLineNumber) + 1) {
                paddedText = paddedText + '\n\n';
            }
        }

        // Apply the edits
        editor.executeEdits(
            '',
            [ { range: range as monaco.Range, text: paddedText, } ],
            [
                monaco.Selection.fromPositions(
                    { lineNumber: 1, column: 1, },
                    { lineNumber: 1, column: 1, },
                ),
            ],
        );
    }
}
