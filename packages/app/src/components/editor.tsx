import Immutable from 'immutable';
import * as React from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import * as proto from '@dashql/proto';
import * as model from '../model';
import * as utils from '../utils';
import classNames from 'classnames';

import { theme as monaco_theme } from './editor_theme_light';
import styles from './editor.module.css';

import sx = proto.syntax;
import { withAutoSizer } from '../utils/autosizer';
import { TokensProvider } from './editor_tokens';

/// Does the mouse movement affect the decorations?
/// Right now, the only mouse effect is focus on dependency target nodes.
const mouseMoveAffectsDecorations = (program: model.Program, prevOffset: number | null, newOffset: number | null) => {
    const tmpNode = new model.Node(program);
    const tmpLoc = new sx.Location();
    const getLoc = (node: model.Node) => {
        const l = node.buffer.location(tmpLoc)!;
        return [l.offset(), l.length()];
    };

    let prevMouseTarget = null;
    let newMouseTarget = null;

    program.iterateDependencies((idx: number, dep: sx.Dependency) => {
        const targetId = dep.targetNode();
        const targetLoc = getLoc(program.getNode(targetId, tmpNode));
        if (prevOffset && targetLoc[0] <= prevOffset && prevOffset <= targetLoc[0] + targetLoc[1]) {
            prevMouseTarget = dep.targetNode();
        }
        if (newOffset && targetLoc[0] <= newOffset && newOffset <= targetLoc[0] + targetLoc[1]) {
            newMouseTarget = dep.targetNode();
        }
    });

    return prevMouseTarget != newMouseTarget;
};

type Props = {
    /// The requested css class name
    className?: string;
    /// The width
    width: number;
    /// The height
    height: number;
};

const InnerEditor: React.FC<Props> = (props: Props) => {
    const [editor, setEditor] = React.useState<monaco.editor.IStandaloneCodeEditor | null>(null);
    const [mouseOffset, setMouseOffset] = React.useState<number | null>(null);
    const monacoRef = React.useRef(null);
    const monacoContainer = (monacoRef.current || null) as HTMLDivElement | null;

    const { script, program } = model.useProgramContext();
    const { statementStatus } = model.usePlanContext();
    const programContextDispatch = model.useProgramContextDispatch();

    // Expose program and script via ref for monaco
    const scriptRef = React.useRef<model.Script>(script);
    const programRef = React.useRef<model.Program | null>(program);
    React.useEffect(() => {
        scriptRef.current = script;
        programRef.current = program;
        if (editor) {
            editor.setValue(script.text);
        }
    }, [script, program]);

    // Stable line breaks
    const lineBreaksRef = React.useRef<Float64Array>(new Float64Array());
    React.useEffect(() => {
        lineBreaksRef.current = program?.getLineBreaks() || new Float64Array();
    }, [program]);

    // Editor setup, this runs only once per monaco container
    const prevMousePosition = React.useRef<monaco.Position | null>(null);
    React.useEffect(() => {
        // Abort if already set or no program available
        if (editor || !monacoContainer) return () => {};

        // Setup tokens & theme
        monaco.languages.register({ id: 'dashql' });
        monaco.languages.setTokensProvider('dashql', new TokensProvider(programRef));
        monaco.editor.defineTheme('dashql-theme', monaco_theme);
        monaco.editor.setTheme('dashql-theme');

        // Create editor
        const e = monaco.editor.create(monacoContainer, {
            fontSize: 13,
            language: 'dashql',
            value: script.text,
            links: false,
            wordWrap: 'off',
            glyphMargin: true,
            minimap: {
                enabled: false,
            },
            scrollBeyondLastLine: false,
        });
        e.setPosition({ column: 0, lineNumber: 0 });
        e.focus();
        e.onMouseDown((ev: monaco.editor.IEditorMouseEvent) => {
            const pos = ev.target.position;
            if (!pos) return;
            if (
                prevMousePosition.current != null &&
                prevMousePosition.current.lineNumber == pos.lineNumber &&
                prevMousePosition.current.column == pos.column
            ) {
                return;
            }
            const zeroIndexed = pos.lineNumber - 1;
            const lineOffset = zeroIndexed == 0 ? 0 : lineBreaksRef.current[zeroIndexed - 1];
            const nextMouseOffset = lineOffset + pos.column - 1;
            prevMousePosition.current = pos;
            setMouseOffset(nextMouseOffset);
        });

        // Finalize the editor
        e.onDidChangeModelContent(_event => {
            if (e.getValue() != scriptRef.current?.text) {
                programContextDispatch({
                    type: model.SET_SCRIPT,
                    data: {
                        ...scriptRef.current,
                        text: e.getValue(),
                        lineCount: e.getModel()?.getLineCount() || 0,
                        bytes: utils.estimateUTF16Length(e.getValue()),
                        modified: true,
                    },
                });
            }
        });

        // Store editor
        setEditor(e);

        // Dispose editor eventually
        return () => e.dispose();
    }, [monacoContainer]);

    // Update markers whenever the program updates
    React.useEffect(() => {
        const data = editor?.getModel();
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
    }, [editor, program]);

    // Update decorations
    const prevDecoration = React.useRef<{
        program: model.Program;
        statementStatus: Immutable.List<model.StatementStatus>;
        mouseOffset: number | null;
        decorationIDs: string[];
    } | null>(null);
    React.useEffect(() => {
        // Get model.
        // Early aborts if editor is not set.
        const data = editor?.getModel();
        if (!data || !program) return;

        // Program && status didn't change and the new mouse position does not affect the decorations?
        // Nothing to do then.
        if (
            prevDecoration.current &&
            prevDecoration.current.program == program &&
            prevDecoration.current.statementStatus == statementStatus &&
            !mouseMoveAffectsDecorations(program, prevDecoration.current.mouseOffset, mouseOffset)
        ) {
            return;
        }

        // Get the state
        const tmpNode = new model.Node(program);
        const tmpLoc = new sx.Location();
        const dec: monaco.editor.IModelDeltaDecoration[] = [];

        // Get location
        const getLoc = (node: model.Node) => {
            const l = node.buffer.location(tmpLoc)!;
            return [l.offset(), l.length()];
        };

        // Get a line from an offset
        const getLineFromOffset = (ofs: number) => {
            const lineBreaks = lineBreaksRef.current;
            const nextBreak = utils.lowerBound(lineBreaks, ofs, (l, r) => l < r, 0, lineBreaks.length);
            const prevOffset = nextBreak == 0 || lineBreaks.length == 0 ? 0 : lineBreaks[nextBreak - 1] + 1; // + \n
            const column = ofs - prevOffset + 1; // Columns are 1 indexed
            return [nextBreak + 1, column]; // Lines are 1 indexed
        };

        // Draw glyphs
        program.iterateStatements((idx: number, stmt: model.Statement) => {
            const root = stmt.root_node(tmpNode);
            const loc = root.buffer.location(tmpLoc)!;
            const ofsBegin = loc!.offset();
            const ofsEnd = loc!.offset() + loc!.length();
            const firstPos = getLineFromOffset(ofsBegin);
            const lastPos = getLineFromOffset(ofsEnd);

            // Add statement decoration
            dec.push({
                range: new monaco.Range(firstPos[0], 1, lastPos[0], 1),
                options: {
                    isWholeLine: true,
                    className: styles.deco_statement,
                },
            });

            // Add status decoration
            const stmtStatus = statementStatus.get(stmt.statementId);
            if (stmtStatus) {
                let glyphClass = styles.deco_glyph_status_none;
                switch (stmtStatus.status) {
                    case proto.task.TaskStatusCode.SKIPPED:
                    case proto.task.TaskStatusCode.BLOCKED:
                        glyphClass = styles.deco_glyph_status_blocked;
                        break;
                    case proto.task.TaskStatusCode.COMPLETED:
                        glyphClass = styles.deco_glyph_status_completed;
                        break;
                    case proto.task.TaskStatusCode.FAILED:
                        glyphClass = styles.deco_glyph_status_failed;
                        break;
                    case proto.task.TaskStatusCode.PENDING:
                        glyphClass = styles.deco_glyph_status_none;
                        break;
                    case proto.task.TaskStatusCode.RUNNING:
                        glyphClass = styles.deco_glyph_status_running;
                        break;
                }
                dec.push({
                    range: new monaco.Range(firstPos[0], 1, firstPos[0], 1),
                    options: {
                        isWholeLine: true,
                        glyphMarginClassName: classNames(styles.deco_glyph_status, glyphClass),
                    },
                });
            }
        });

        // Highlight ranges
        program.iterateDependencies((idx: number, dep: sx.Dependency) => {
            const targetLoc = getLoc(program.getNode(dep.targetNode(), tmpNode));
            const targetBegin = getLineFromOffset(targetLoc[0]);
            const targetEnd = getLineFromOffset(targetLoc[0] + targetLoc[1]);
            const targetRange = new monaco.Range(targetBegin[0], targetBegin[1], targetEnd[0], targetEnd[1]);
            if (mouseOffset && targetLoc[0] <= mouseOffset && mouseOffset <= targetLoc[0] + targetLoc[1]) {
                const sourceStmtId = dep.sourceStatement();
                const sourceStmt = program.getStatement(sourceStmtId);
                const sourceLoc = getLoc(sourceStmt.root_node(tmpNode));
                const sourceBegin = getLineFromOffset(sourceLoc[0]);
                const sourceEnd = getLineFromOffset(sourceLoc[0] + sourceLoc[1]);
                const sourceRange = new monaco.Range(sourceBegin[0], sourceBegin[1], sourceEnd[0], sourceEnd[1]);

                dec.push({
                    range: targetRange,
                    options: {
                        className: styles.dep_target_focused,
                    },
                });
                dec.push({
                    range: sourceRange,
                    options: {
                        isWholeLine: true,
                        className: styles.dep_source_focused,
                    },
                });
            } else {
                dec.push({
                    range: targetRange,
                    options: {
                        className: styles.dep_target,
                    },
                });
            }
        });
        prevDecoration.current = {
            program: program,
            statementStatus: statementStatus,
            mouseOffset: mouseOffset,
            decorationIDs: data.deltaDecorations(prevDecoration.current?.decorationIDs || [], dec),
        };
    }, [editor, program, statementStatus, mouseOffset]);

    /// Debounce editor layouting
    const delayedResize = React.useRef<number | null>();
    React.useEffect(() => {
        const delayMs = 100;
        delayedResize.current = window.setTimeout(() => {
            if (editor == null || delayedResize.current == null) return;
            editor.layout({
                height: props.height,
                width: props.width,
            });
            delayedResize.current = null;
        }, delayMs);
        return () => {
            if (delayedResize.current == null) return;
            clearTimeout(delayedResize.current);
            delayedResize.current = null;
        };
    }, [editor, props.width, props.height]);

    // Return the placeholders
    return (
        <div className={classNames(styles.editor, props.className)}>
            <div className={styles.editor_monaco} ref={monacoRef} />
        </div>
    );
};

export default withAutoSizer(InnerEditor);
