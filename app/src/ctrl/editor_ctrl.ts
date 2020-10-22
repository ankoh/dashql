import * as monaco from 'monaco-editor';
import * as parser from '@dashql/parser';
import { AppReduxStore, AppStateMutations } from '../store';

export class EditorController {
    /// The editor
    protected _editor: monaco.editor.IStandaloneCodeEditor | null;
    /// The store
    protected _store: AppReduxStore;
    /// The parser
    protected _parser: parser.DashQLParser;

    /// Constructor
    constructor(store: AppReduxStore, parser: parser.DashQLParser) {
        this._store = store;
        this._parser = parser;
        this._editor = null;
    }

    public registerEditor(editor: monaco.editor.IStandaloneCodeEditor) {
        this._editor = editor;
    }

    /// Evaluate an editor
    public async evaluate(input: string) {
        let program = await this._parser.parse(input);
        this.displayErrors(program.root);
        this._store.dispatch(AppStateMutations.setEditorProgram(program));
    }

    /// Display program errors
    protected displayErrors(program: parser.proto.program.Program): void {
        const model = this._editor?.getModel();
        if (!model) {
            return;
        }
        let markers = new Array<monaco.editor.IMarkerData>();
        for (let i = 0; i < program.errorsLength(); ++i) {
            const error = program.errors(i);
            const location = error?.location();
            const begin = location?.begin();
            const startLineNumber = begin?.line();
            const startColumn = begin?.column();
            const end = location?.end();
            const endLineNumber = end?.line();
            const endColumn = end?.column();
            if (!startLineNumber || !startColumn || !endLineNumber || !endColumn) {
                return undefined;
            }
            markers.push({
                startLineNumber,
                startColumn,
                endLineNumber,
                endColumn,
                message: error.message(),
                severity: monaco.MarkerSeverity.Error,
            });
        }
        monaco.editor.setModelMarkers(model, 'TQL', markers);
    }

    public replace(location: parser.proto.program.Location, text: string | null) {
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
        const begin = location.begin();
        const end = location.end();
        const range = {
            startLineNumber: begin?.line() ?? 1,
            startColumn: begin?.column() ?? 1,
            endLineNumber: end?.line() ?? 1,
            endColumn: end?.column() ?? 1,
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

