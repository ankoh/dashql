import * as monaco from 'monaco-editor';
import * as core from '@dashql/core';

export class EditorController {
    /// The platform
    protected _platform: core.platform.Platform;
    /// The editor
    protected _editor: monaco.editor.IStandaloneCodeEditor | null;

    /// Constructor
    constructor(platform: core.platform.Platform) {
        this._platform = platform;
        this._editor = null;
        core.model.observeStore(platform.store, (s) => (s.core.program), this.programChanged.bind(this));
    }

    /// Register the monaco editor
    public registerEditor(editor: monaco.editor.IStandaloneCodeEditor) {
        this._editor = editor;
        this.updateMarkers();
    }

    /// Program changed, adjust the model
    public programChanged(_program: core.model.Program | null) {
        this.updateMarkers();
    }

    public updateMarkers() {
        const state = this._platform.store.getState();
        const program = state.core.program;
        const data = this._editor?.getModel();
        if (!data) return;

        if (!program) {
            monaco.editor.setModelMarkers(data, 'DashQL', []);
        } else {
            const markers: monaco.editor.IMarkerData[] = [];
            for (let i = 0; i < program.buffer.errorsLength(); ++i) {
                const error = program.buffer.errors(i)!;
                const location = error.location()!;
                const begin = data.getPositionAt(location.offset());
                const startLineNumber = begin.lineNumber;
                const startColumn = begin.column;
                const end = data.getPositionAt(location.offset() + location.length());
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
                    message: error.message() ?? '',
                    severity: monaco.MarkerSeverity.Error,
                });
            }
            monaco.editor.setModelMarkers(data, 'DashQL', markers);
        }
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
            if (
                range.endLineNumber == model.getLineCount() &&
                range.endColumn == model.getLineLength(range.endLineNumber) + 1
            ) {
                paddedText = paddedText + '\n';
            } else if (range.endColumn == 1 || range.endColumn == model.getLineLength(range.endLineNumber) + 1) {
                paddedText = paddedText + '\n\n';
            }
        }

        // Apply the edits
        editor.executeEdits(
            '',
            [{ range: range as monaco.Range, text: paddedText }],
            [monaco.Selection.fromPositions({ lineNumber: 1, column: 1 }, { lineNumber: 1, column: 1 })],
        );
    }
}
