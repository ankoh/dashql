import Immutable from 'immutable';
import classNames from 'classnames';
import * as React from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import * as proto from '@dashql/dashql-proto';
import * as model from '../model';
import * as utils from '../utils';

import { theme as monaco_theme } from './editor_theme_light';
import styles from './editor.module.css';

import { SizeObserver, useObservedSize } from '../utils/size_observer';
import { TokensProvider } from '../model/editor_tokens';
import { TaskStatusCode } from '../model/task_status';
import { useWorkflowSession, useWorkflowSessionState, WorkflowSession } from '../backend/workflow_session';

/// Does the mouse movement affect the decorations?
/// Right now, the only mouse effect is focus on dependency target nodes.
const mouseMoveAffectsDecorations = (
    program: model.Program,
    programAnalysis: model.ProgramAnalysis,
    prevOffset: number | null,
    newOffset: number | null,
) => {
    const tmpNode = new model.Node(program);
    const tmpLoc = new proto.Location();
    const getLoc = (node: model.Node) => {
        const l = node.buffer.location(tmpLoc)!;
        return [l.offset(), l.length()];
    };

    let prevMouseTarget = null;
    let newMouseTarget = null;

    for (const dep of programAnalysis.statement_dependencies) {
        const targetId = dep.target_node;
        const targetLoc = getLoc(program.getNode(targetId, tmpNode));
        if (prevOffset && targetLoc[0] <= prevOffset && prevOffset <= targetLoc[0] + targetLoc[1]) {
            prevMouseTarget = dep.target_node;
        }
        if (newOffset && targetLoc[0] <= newOffset && newOffset <= targetLoc[0] + targetLoc[1]) {
            newMouseTarget = dep.target_node;
        }
    }

    return prevMouseTarget != newMouseTarget;
};

type Props = {
    /// The requested css class name
    className?: string;
    /// Is readonly?
    readOnly: boolean;
    /// The target
    target?: HTMLDivElement;
};

export const Editor: React.FC<Props> = (props: Props) => {
    const session = useWorkflowSession();
    const sessionState = useWorkflowSessionState();
    const sessionRef = React.useRef<WorkflowSession | null>(session);

    const [editor, setEditor] = React.useState<monaco.editor.IStandaloneCodeEditor | null>(null);
    const [mouseOffset, setMouseOffset] = React.useState<number | null>(null);
    const monacoRef = React.useRef(null);
    const monacoContainer = (props.target || monacoRef.current) as HTMLDivElement | null;

    React.useEffect(() => {
        sessionRef.current = session;
    }, [session]);
    React.useEffect(() => {
        // Update readOnly settings
        if (editor && editor.getOption(monaco.editor.EditorOption.readOnly) != props.readOnly) {
            editor.updateOptions({
                readOnly: props.readOnly,
                renderLineHighlight: props.readOnly ? 'none' : 'all',
            });
        }
    }, [props.readOnly]);

    // Editor setup, this runs only once per monaco container
    const prevMousePosition = React.useRef<monaco.Position | null>(null);
    React.useEffect(() => {
        // Abort if already set or no program available
        if (editor || !monacoContainer) return () => {};

        // Setup tokens & theme
        monaco.languages.register({ id: 'dashql' });
        monaco.languages.setTokensProvider(
            'dashql',
            new TokensProvider(() => sessionRef.current?.uncommittedState.program),
        );
        monaco.editor.defineTheme('dashql-theme', monaco_theme);
        monaco.editor.setTheme('dashql-theme');

        // Create editor
        const e = monaco.editor.create(monacoContainer, {
            // fontFamily: 'Roboto Mono',
            fontSize: 13,
            language: 'dashql',
            value: sessionRef.current?.uncommittedState.programText ?? '',
            links: false,
            wordWrap: 'off',
            glyphMargin: true,
            minimap: {
                enabled: false,
            },
            scrollBeyondLastLine: false,
            readOnly: props.readOnly,
            renderLineHighlight: props.readOnly ? 'none' : 'all',
        });
        e.setPosition({ column: 0, lineNumber: 0 });
        if (!props.readOnly) e.focus();
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
            const session = sessionRef.current;
            const zeroIndexed = pos.lineNumber - 1;
            const lineOffset =
                zeroIndexed == 0 ? 0 : session.uncommittedState.program?.getLineBreaks()[zeroIndexed - 1];
            const nextMouseOffset = lineOffset + pos.column - 1;
            prevMousePosition.current = pos;
            setMouseOffset(nextMouseOffset);
        });

        // Update the program text whenever necessary
        e.onDidChangeModelContent(_event => {
            const session = sessionRef.current;
            if (session == null) {
                return;
            }
            if (e.getValue() != session.uncommittedState.programText) {
                session.updateProgram(e.getValue());
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

        if (!sessionState.program) {
            monaco.editor.setModelMarkers(data, 'dashql-model', []);
        } else {
            const markers: monaco.editor.IMarkerData[] = [];
            for (let i = 0; i < sessionState.program.ast.errorsLength(); ++i) {
                const error = sessionState.program.ast.errors(i)!;
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
    }, [editor, sessionState.program]);

    // Update decorations
    const prevDecoration = React.useRef<{
        program: model.Program;
        statementStatus: Immutable.Map<number, model.StatementStatus>;
        mouseOffset: number | null;
        decorationIDs: string[];
    } | null>(null);
    React.useEffect(() => {
        // Get model.
        // Early aborts if editor is not set.
        const data = editor?.getModel();
        const program = sessionState.program;
        const programAnalysis = sessionState.programAnalysis;
        if (!data || !program || !programAnalysis) return;
        const lineBreaks = program.getLineBreaks();

        // Program && status didn't change and the new mouse position does not affect the decorations?
        // Nothing to do then.
        if (
            prevDecoration.current &&
            prevDecoration.current.program == program &&
            prevDecoration.current.statementStatus == sessionState.statusByStatement &&
            !mouseMoveAffectsDecorations(program, programAnalysis, prevDecoration.current.mouseOffset, mouseOffset)
        ) {
            console.log('SKIP DECO UPDATE');
            return;
        }
        console.log('DECO UPDATE');
        console.log(prevDecoration.current?.program != program);
        console.log(prevDecoration.current?.statementStatus != sessionState.statusByStatement);
        console.log(
            mouseMoveAffectsDecorations(
                program,
                programAnalysis,
                prevDecoration.current?.mouseOffset ?? 0,
                mouseOffset,
            ),
        );
        console.log(prevDecoration.current?.program);
        console.log(program);

        // Get the state
        const tmpNode = new model.Node(program);
        const tmpLoc = new proto.Location();
        const dec: monaco.editor.IModelDeltaDecoration[] = [];

        // Get location
        const getLoc = (node: model.Node) => {
            const l = node.buffer.location(tmpLoc)!;
            return [l.offset(), l.length()];
        };

        // Get a line from an offset
        const getLineFromOffset = (ofs: number) => {
            const nextBreak = utils.lowerBound(lineBreaks, ofs, (l, r) => l < r, 0, lineBreaks.length);
            const prevOffset = nextBreak == 0 || lineBreaks.length == 0 ? 0 : lineBreaks[nextBreak - 1] + 1; // + \n
            const column = ofs - prevOffset + 1; // Columns are 1 indexed
            return [nextBreak + 1, column]; // Lines are 1 indexed
        };

        // Draw glyphs
        console.log([...sessionState.statusByStatement.entries()]);
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
            const stmtStatus = sessionState.statusByStatement.get(stmt.statementId);
            if (stmtStatus) {
                let glyphClass = styles.deco_glyph_status_none;
                switch (stmtStatus.status) {
                    case TaskStatusCode.Skipped:
                    case TaskStatusCode.Blocked:
                        glyphClass = styles.deco_glyph_status_blocked;
                        break;
                    case TaskStatusCode.Completed:
                        glyphClass = styles.deco_glyph_status_completed;
                        break;
                    case TaskStatusCode.Failed:
                        glyphClass = styles.deco_glyph_status_failed;
                        break;
                    case TaskStatusCode.Pending:
                        glyphClass = styles.deco_glyph_status_none;
                        break;
                    case TaskStatusCode.Preparing:
                    case TaskStatusCode.Prepared:
                    case TaskStatusCode.Executing:
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
        for (const dep of programAnalysis.statement_dependencies) {
            const targetLoc = getLoc(program.getNode(dep.target_node, tmpNode));
            const targetBegin = getLineFromOffset(targetLoc[0]);
            const targetEnd = getLineFromOffset(targetLoc[0] + targetLoc[1]);
            const targetRange = new monaco.Range(targetBegin[0], targetBegin[1], targetEnd[0], targetEnd[1]);
            if (mouseOffset && targetLoc[0] <= mouseOffset && mouseOffset <= targetLoc[0] + targetLoc[1]) {
                const sourceStmtId = dep.source_stmt;
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
        }
        prevDecoration.current = {
            program: program,
            statementStatus: sessionState.statusByStatement,
            mouseOffset: mouseOffset,
            decorationIDs: data.deltaDecorations(prevDecoration.current?.decorationIDs || [], dec),
        };
    }, [editor, sessionState.program, sessionState.programAnalysis, sessionState.statusByStatement, mouseOffset]);

    /// Debounce editor layouting
    const delayedResize = React.useRef<number | null>();
    const size = useObservedSize();
    React.useEffect(() => {
        if (size == null) return () => {};
        const delayMs = 100;
        delayedResize.current = window.setTimeout(() => {
            if (editor == null || delayedResize.current == null) return;
            editor.layout({
                height: size.height,
                width: size.width,
            });
            delayedResize.current = null;
        }, delayMs);
        return () => {
            if (delayedResize.current == null) return;
            clearTimeout(delayedResize.current);
            delayedResize.current = null;
        };
    }, [editor, size, size]);

    // Return the placeholders
    return (
        <div className={classNames(styles.editor, props.className)}>
            <div className={styles.editor_monaco} ref={monacoRef} />
        </div>
    );
};

export const ResizingEditor: React.FC<Props> = (props: Props) => (
    <SizeObserver>
        <Editor {...props} />
    </SizeObserver>
);
export default ResizingEditor;
