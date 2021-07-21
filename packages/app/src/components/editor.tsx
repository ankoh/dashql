import Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as model from '../model';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import * as proto from '@dashql/proto';
import { AutoSizer } from '../util/autosizer';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../app_context';
import classNames from 'classnames';

import { theme as monaco_theme } from './editor_theme_light';
import styles from './editor.module.css';

import sx = proto.syntax;

/** Dummy state to propagate the line number through the TokensProvider API.
 *  We rely on the fact here that the model passes this state from line to line sequentially.
 *  Ref: https://microsoft.github.io/monaco-editor/api/interfaces/monaco.languages.istate.html
 *
 *  This is hacky but the tokenize() function gets a single string as input instead of a line number.
 *  That is super useless to us since we already have all the tokens.
 */
class TokensProviderState implements monaco.languages.IState {
    /** Constructor */
    constructor(protected _lineNumber: number = -1) {}
    /** Get the line number */
    public get lineNumber() {
        return this._lineNumber;
    }
    public advance() {
        this._lineNumber += 1;
    }
    /** Equality check */
    equals(other: TokensProviderState) {
        return this._lineNumber == other._lineNumber;
    }
    /** Clone the state */
    clone() {
        return new TokensProviderState(this._lineNumber);
    }
}

class TokensProvider implements monaco.languages.TokensProvider {
    /// The redux store
    _store: model.AppReduxStore;

    constructor(store: model.AppReduxStore) {
        this._store = store;
    }

    getInitialState(): monaco.languages.IState {
        return new TokensProviderState();
    }

    tokenize(_line: string, state: TokensProviderState): monaco.languages.ILineTokens {
        state.advance();
        const result: monaco.languages.ILineTokens = {
            tokens: [],
            endState: state,
        };

        // Get highlighting data
        const store = this._store.getState();
        const buffer = store.core.program?.buffer;
        const hl = buffer?.highlighting();
        if (!hl) return result;

        // Line break valid?
        const tokenBreaks = hl.tokenBreaksArray()!;
        const tokenOffsets = hl.tokenOffsetsArray()!;
        const tokenTypes = hl.tokenTypesArray()!;

        // Resolve token range & lineOffset
        // breaks[0] refers to the offset of the first token after linebreak 0
        const tokenBegin = state.lineNumber == 0 ? 0 : tokenBreaks[state.lineNumber - 1];
        const tokenEnd = state.lineNumber < tokenBreaks.length ? tokenBreaks[state.lineNumber] : tokenOffsets.length;

        // Resolve line offset
        let lineOffset = 0;
        if (state.lineNumber > 0) {
            const prevLineBreak = buffer?.lineBreaks(state.lineNumber - 1);
            lineOffset = prevLineBreak ? prevLineBreak.offset() + prevLineBreak.length() : 0;
        }

        // Read all tokens
        for (let i = tokenBegin; i < tokenEnd; ++i) {
            const token = {
                startIndex: tokenOffsets[i] - lineOffset,
                scopes: '',
            };
            switch (tokenTypes[i] as proto.syntax.HighlightingTokenType) {
                case proto.syntax.HighlightingTokenType.KEYWORD:
                    token.scopes = 'keyword';
                    break;
                case proto.syntax.HighlightingTokenType.LITERAL_INTEGER:
                case proto.syntax.HighlightingTokenType.LITERAL_FLOAT:
                case proto.syntax.HighlightingTokenType.LITERAL_HEX:
                case proto.syntax.HighlightingTokenType.LITERAL_BOOLEAN:
                case proto.syntax.HighlightingTokenType.LITERAL_BINARY:
                    token.scopes = 'literal';
                    break;
                case proto.syntax.HighlightingTokenType.LITERAL_STRING:
                    token.scopes = 'string';
                    break;
                case proto.syntax.HighlightingTokenType.COMMENT:
                    token.scopes = 'comment';
                    break;
                case proto.syntax.HighlightingTokenType.OPERATOR:
                    token.scopes = 'keyword.operator';
                    break;
                case proto.syntax.HighlightingTokenType.OPTION_KEY:
                    token.scopes = 'option.key';
                    break;
                case proto.syntax.HighlightingTokenType.IDENTIFIER:
                    token.scopes = '';
                    break;
                // XXX
            }
            result.tokens.push(token);
        }
        return result;
    }
}

interface DebouncedResize {
    timer: number;
    width: number;
    height: number;
}

type Props = {
    /// The app context
    appContext: IAppContext;
    /// The requested css class name
    className?: string;
    /// The current script
    script: core.model.Script;
    /// The program
    program: core.model.Program;
    /// The program status
    programStatus: Immutable.List<core.model.StatementStatus>;

    /// Update handler for editor input
    updateScript: (script: core.model.Script) => void;
};

type State = {
    // The mouse position
    mousePosition: monaco.Position | null;
    // The mouse offset
    mouseOffset: number | null;
    // The last event
    lineBreaks: Float64Array;
    // The current decoration ids
    decorationIDs: string[];
    // Pending editor resize
    pendingResize: DebouncedResize | null;
};

class Editor extends React.Component<Props, State> {
    // The monaco container
    protected monacoContainer: HTMLDivElement | null;
    // The monaco editor
    protected editor: monaco.editor.IStandaloneCodeEditor | null;

    /// Constructor
    constructor(props: Props) {
        super(props);
        this.monacoContainer = null;
        this.editor = null;
        this.state = {
            mousePosition: null,
            mouseOffset: null,
            decorationIDs: [],
            lineBreaks: props.program.getLineBreaks(),
            pendingResize: null,
        };
    }

    /// The bound hover handler
    protected _onMouseMove = this.onMouseMove.bind(this);
    /// Hover handler
    public onMouseMove(e: monaco.editor.IEditorMouseEvent) {
        const pos = e.target.position;
        if (!pos) return;
        if (
            this.state.mousePosition != null &&
            this.state.mousePosition.lineNumber == pos.lineNumber &&
            this.state.mousePosition.column == pos.column
        ) {
            return;
        }
        const zeroIndexed = pos.lineNumber - 1;
        const lineOffset = zeroIndexed == 0 ? 0 : this.state.lineBreaks[zeroIndexed - 1];
        const mouseOffset = lineOffset + pos.column - 1;
        this.setState({
            ...this.state,
            mousePosition: pos,
            mouseOffset,
        });
        return null;
    }

    /// The component did mount, init monaco
    public componentDidMount() {
        if (!this.monacoContainer) return;

        // Setup tokens & theme
        monaco.languages.register({ id: 'dashql' });
        monaco.languages.setTokensProvider('dashql', new TokensProvider(this.props.appContext.store));
        monaco.editor.defineTheme('dashql-theme', monaco_theme);
        monaco.editor.setTheme('dashql-theme');

        // Create editor
        this.editor = monaco.editor.create(this.monacoContainer, {
            fontSize: 13,
            language: 'dashql',
            value: this.props.script.text,
            links: false,
            wordWrap: 'on',
            glyphMargin: true,
            minimap: {
                enabled: false,
            },
            scrollBeyondLastLine: false,
        });
        this.editor.setPosition({ column: 0, lineNumber: 0 });
        this.editor.focus();
        this.editor.onMouseMove(this._onMouseMove);

        // Finalize the editor
        const editor = this.editor!;
        editor.onDidChangeModelContent(_event => {
            if (editor.getValue() != this.props.script.text) {
                this.props.updateScript({
                    ...this.props.script,
                    text: editor.getValue(),
                    lineCount: editor.getModel()?.getLineCount() || 0,
                    bytes: core.utils.estimateUTF16Length(editor.getValue()),
                    modified: true,
                });
            }
        });
        if (this.monacoContainer) {
            this.resizeEditorDelayed(this.monacoContainer.offsetHeight, this.monacoContainer.offsetWidth);
        }

        this.updateMarkers();
        this.updateDecorations();
    }

    /// The component did update, sync monaco
    public componentDidUpdate(prevProps: Props, prevState: State) {
        // Editor not set?
        if (!this.editor) {
            return;
        }
        // Prop update?
        if (prevProps != this.props) {
            // Value changed?
            if (this.editor.getValue() !== this.props.script.text) {
                this.editor.setValue(this.props.script.text);
            }
            // Program changed?
            if (prevProps.program !== this.props.program) {
                this.setState({
                    lineBreaks: this.props.program.getLineBreaks(),
                });
                this.updateMarkers();
                this.updateDecorations();
                return;
            }
            // Program status changed?
            if (prevProps.programStatus !== this.props.programStatus) {
                this.updateDecorations();
                return;
            }
        } else {
            // Do we have to update the decorations?
            if (prevState.mousePosition !== this.state.mousePosition) {
                this.updateDecorations();
                return;
            }
        }
    }

    /// Unmount the component
    public componentWillUnmount() {
        if (this.state.pendingResize) {
            clearTimeout(this.state.pendingResize.timer);
        }
        if (this.editor !== null) {
            this.editor.dispose();
        }
    }

    /// Resize the editor with a delay since this is expensive
    protected resizeEditorDelayed(height: number, width: number) {
        const delayMs = 100;
        if (this.state.pendingResize != null) {
            clearTimeout(this.state.pendingResize.timer);
        }
        this.setState({
            ...this.state,
            pendingResize: {
                height,
                width,
                timer: window.setTimeout(this._resizeEditor, delayMs),
            },
        });
    }

    /// Bound resize handler
    protected _resizeEditor = this.resizeEditor.bind(this);
    /// Resize the editor
    protected resizeEditor() {
        if (this.editor == null || this.state.pendingResize == null) return;
        this.editor.layout({
            height: this.state.pendingResize.height,
            width: this.state.pendingResize.width,
        });
        this.setState({
            ...this.state,
            pendingResize: null,
        });
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

    /// Update all decorations
    public updateDecorations() {
        // Get model
        const data = this.editor?.getModel();
        if (!data) return;

        // Get the state
        const program = this.props.program;
        const programStatus = this.props.programStatus;
        const tmpNode = new core.model.Node(program);
        const tmpLoc = new sx.Location();
        const decorations: monaco.editor.IModelDeltaDecoration[] = [];

        // Get location
        const getLoc = (node: core.model.Node) => {
            const l = node.buffer.location(tmpLoc)!;
            return [l.offset(), l.length()];
        };

        // Get line from offset
        const getLine = (ofs: number) => {
            const breaks = this.state.lineBreaks;
            const nextBreak = core.utils.lowerBound(breaks, ofs, (l, r) => l < r, 0, breaks.length);
            const prevOffset = nextBreak == 0 || breaks.length == 0 ? 0 : breaks[nextBreak - 1] + 1; // + \n
            const column = ofs - prevOffset + 1; // Columns are 1 indexed
            return [nextBreak + 1, column]; // Lines are 1 indexed
        };

        // Collect the status statement decorations
        program.iterateStatements((idx: number, stmt: core.model.Statement) => {
            const root = stmt.root_node(tmpNode);
            const loc = root.buffer.location(tmpLoc)!;
            const ofsBegin = loc!.offset();
            const ofsEnd = loc!.offset() + loc!.length();
            const firstPos = getLine(ofsBegin);
            const lastPos = getLine(ofsEnd);

            // Add statement decoration
            decorations.push({
                range: new monaco.Range(firstPos[0], 1, lastPos[0], 1),
                options: {
                    isWholeLine: true,
                    className: styles.deco_statement,
                },
            });

            // Add status decoration
            const stmtStatus = programStatus.get(stmt.statementId);
            if (stmtStatus) {
                let glyphClass = styles.deco_glyph_status_none;
                switch (stmtStatus.status) {
                    case proto.action.ActionStatusCode.BLOCKED:
                        glyphClass = styles.deco_glyph_status_blocked;
                        break;
                    case proto.action.ActionStatusCode.COMPLETED:
                        glyphClass = styles.deco_glyph_status_completed;
                        break;
                    case proto.action.ActionStatusCode.FAILED:
                        glyphClass = styles.deco_glyph_status_failed;
                        break;
                    case proto.action.ActionStatusCode.NONE:
                        glyphClass = styles.deco_glyph_status_none;
                        break;
                    case proto.action.ActionStatusCode.RUNNING:
                        glyphClass = styles.deco_glyph_status_running;
                        break;
                }
                decorations.push({
                    range: new monaco.Range(firstPos[0], 1, firstPos[0], 1),
                    options: {
                        isWholeLine: true,
                        glyphMarginClassName: classNames(styles.deco_glyph_status, glyphClass),
                    },
                });
            }
        });

        program.iterateDependencies((idx: number, dep: sx.Dependency) => {
            const targetLoc = getLoc(program.getNode(dep.targetNode(), tmpNode));
            const targetBegin = getLine(targetLoc[0]);
            const targetEnd = getLine(targetLoc[0] + targetLoc[1]);
            if (
                this.state.mouseOffset &&
                targetLoc[0] <= this.state.mouseOffset &&
                this.state.mouseOffset <= targetLoc[0] + targetLoc[1]
            ) {
                const sourceStmtId = dep.sourceStatement();
                const sourceStmt = program.getStatement(sourceStmtId);
                const sourceLoc = getLoc(sourceStmt.root_node(tmpNode));
                const sourceBegin = getLine(sourceLoc[0]);
                const sourceEnd = getLine(sourceLoc[0] + sourceLoc[1]);
                decorations.push({
                    range: new monaco.Range(targetBegin[0], targetBegin[1], targetEnd[0], targetEnd[1]),
                    options: {
                        className: styles.dep_target_focused,
                    },
                });
                decorations.push({
                    range: new monaco.Range(sourceBegin[0], sourceBegin[1], sourceEnd[0], sourceEnd[1]),
                    options: {
                        isWholeLine: true,
                        className: styles.dep_source_focused,
                    },
                });
            } else {
                decorations.push({
                    range: new monaco.Range(targetBegin[0], targetBegin[1], targetEnd[0], targetEnd[1]),
                    options: {
                        className: styles.dep_target,
                    },
                });
            }
        });

        // Update decorations
        this.setState({
            ...this.state,
            decorationIDs: data.deltaDecorations(this.state.decorationIDs, decorations),
        });
    }

    public updateMarkers() {
        const state = this.props.appContext.store.getState();
        const program = state.core.program;
        const data = this.editor?.getModel();
        if (!data) return;

        if (!program) {
            monaco.editor.setModelMarkers(data, 'dashql-model', []);
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
            monaco.editor.setModelMarkers(data, 'dashql-model', markers);
        }
    }
}

const mapStateToProps = (state: model.AppState) => ({
    script: state.core.script,
    program: state.core.program || new core.model.Program(),
    programStatus: state.core.planState.status,
});

const mapDispatchToProps = (dispatch: model.Dispatch) => ({
    updateScript: (script: core.model.Script) =>
        model.mutate(dispatch, {
            type: core.model.StateMutationType.SET_SCRIPT,
            data: script,
        }),
});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(Editor));
