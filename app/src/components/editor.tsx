import * as React from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import * as core from '@dashql/core';
import { AutoSizer } from '../util/autosizer';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../app_context';
import * as model from '../model';
import classNames from 'classnames';

import { theme as monaco_theme } from './editor_theme_light';
import styles from './editor.module.css';

type Props = {
    appContext: IAppContext;
    className?: string;
    programText: string;
    program: core.model.Program;

    updateProgramText: (txt: string, lines: number) => void;
};

class Editor extends React.Component<Props> {
    // The monaco container
    protected monacoContainer: HTMLDivElement | null;
    // The monaco editor
    protected editor: monaco.editor.IStandaloneCodeEditor | null;
    // Pending editor resize
    protected pendingEditorResize: number | null;

    /// Constructor
    constructor(props: Props) {
        super(props);
        this.monacoContainer = null;
        this.editor = null;
        this.pendingEditorResize = null;
    }

    /// The component did mount, init monaco
    public componentDidMount() {
        this.initMonaco();
    }

    /// The component did update, sync monaco
    public componentDidUpdate(_prevProps: Props) {
        // Editor not set?
        if (!this.editor) {
            return;
        }
        // Value changed?
        if (this.editor && this.editor.getValue() !== this.props.programText) {
            this.editor.setValue(this.props.programText);
        }
        // Layout editor
        if (this.monacoContainer) {
            this.resizeEditorDelayed(this.monacoContainer.offsetHeight, this.monacoContainer.offsetWidth);
        }
    }

    public componentWillUnmount() {
        this.destroyMonaco();
    }

    /// Init the monaco editor
    protected initMonaco() {
        if (this.monacoContainer) {
            this.editor = monaco.editor.create(this.monacoContainer, {
                fontSize: 13,
                language: 'sql',
                value: this.props.programText,
                links: false,
                minimap: {
                    enabled: false,
                },
                scrollBeyondLastLine: false,
            });
            this.editor.setPosition({ column: 0, lineNumber: 0 });
            this.editor.focus();

            // Set theme
            monaco.editor.defineTheme('dashql', monaco_theme);
            monaco.editor.setTheme('dashql');

            // Finalize the editor
            this.editorDidMount();
        }
    }

    /// Destroy the monaco editor
    protected destroyMonaco() {
        if (this.editor !== null) {
            this.editor.dispose();
        }
    }

    /// The editor did mount, register the event handler
    public editorDidMount() {
        const editor = this.editor!;
        editor.onDidChangeModelContent(_event => {
            if (editor.getValue() != this.props.programText) {
                this.props.updateProgramText(editor.getValue(), editor.getModel()?.getLineCount() || 0);
            }
        });
        if (this.monacoContainer) {
            this.resizeEditorDelayed(this.monacoContainer.offsetHeight, this.monacoContainer.offsetWidth);
        }
    }

    /// Resize the editor with a delay since this is expensive
    protected resizeEditorDelayed(height: number, width: number) {
        const delayMs = 100;
        if (this.pendingEditorResize != null) {
            clearTimeout(this.pendingEditorResize);
        }
        this.pendingEditorResize = window.setTimeout(() => {
            this.resizeEditor(height, width);
        }, delayMs);
    }

    /// Resize the editor
    protected resizeEditor(height: number, width: number) {
        if (this.editor) {
            this.editor.layout({
                height: height,
                width: width,
            });
        }
    }

    /// Render the monaco editor
    render() {
        return (
            <div className={classNames(styles.editor, this.props.className)}>
                <AutoSizer
                    onResize={(size: { height: number; width: number }) => {
                        this.resizeEditorDelayed(size.height, size.width);
                    }}
                >
                    {_size => <div className={styles.editor_monaco} ref={ref => (this.monacoContainer = ref)} />}
                </AutoSizer>
            </div>
        );
    }

    public updateMarkers() {
        const state = this.props.appContext.store.getState();
        const program = state.core.program;
        const data = this.editor?.getModel();
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
        if (!this.editor) {
            return;
        }

        /// Get monaco model
        const model = this.editor.getModel();
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
        this.editor.executeEdits(
            '',
            [{ range: range as monaco.Range, text: paddedText }],
            [monaco.Selection.fromPositions({ lineNumber: 1, column: 1 }, { lineNumber: 1, column: 1 })],
        );
    }
}

const mapStateToProps = (state: model.AppState) => ({
    programText: state.core.programText,
    program: state.core.program || new core.model.Program(),
});

const mapDispatchToProps = (dispatch: model.Dispatch) => ({
    updateProgramText: (txt: string, lines: number) =>
        model.mutate(dispatch, {
            type: core.model.StateMutationType.SET_PROGRAM_TEXT,
            data: [txt, lines],
        }),
});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(Editor));
