import * as dashql from '../../core/index.js';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { EditorState, Transaction, StateField, RangeSetBuilder } from '@codemirror/state';

import { DashQLProcessorPlugin, DashQLScriptBuffers, DashQLScriptKey } from './dashql_processor.js';
import { buildDecorationsFromTokens } from './dashql_decorations_standalone.js';
import { FocusType, SemanticUserFocus } from '../../notebook/focus.js';

import './dashql_decorations.css';

const CursorTableReference = Decoration.mark({
    class: 'dashql-tableref-cursor',
});
const FocusedTableReferenceDecoration = Decoration.mark({
    class: 'dashql-tableref-focus',
});
const ResolvedTableReferenceDecoration = Decoration.mark({
    class: 'dashql-tableref-resolved',
});
const UnresolvedTableReferenceDecoration = Decoration.mark({
    class: 'dashql-tableref-unresolved',
});
const CursorColumnReference = Decoration.mark({
    class: 'dashql-colref-cursor',
});
const FocusedColumnReferenceDecoration = Decoration.mark({
    class: 'dashql-colref-focus',
});
const ResolvedColumnReferenceDecoration = Decoration.mark({
    class: 'dashql-colref-resolved',
});
const UnresolvedColumnReferenceDecoration = Decoration.mark({
    class: 'dashql-colref-unresolved',
});
const ErrorDecoration = Decoration.mark({
    class: 'dashql-error',
});

function buildDecorationsFromErrors(
    _state: EditorState,
    scriptBuffers: DashQLScriptBuffers,
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const decorations: DecorationInfo[] = [];

    const parsed = scriptBuffers.parsed?.read() ?? null;
    const analyzed = scriptBuffers.analyzed?.read() ?? null;

    const tmpError = new dashql.buffers.parser.Error();
    const tmpAnalyzerError = new dashql.buffers.analyzer.AnalyzerError();

    if (parsed != null) {
        // Scanner errors
        for (let i = 0; i < parsed.scannerErrorsLength(); ++i) {
            const error = parsed.scannerErrors(i, tmpError)!;
            const loc = error.textSpan()!;
            decorations.push({
                from: loc.offset(),
                to: loc.offset() + loc.length(),
                decoration: ErrorDecoration,
            });
        }
        // Parser errors
        for (let i = 0; i < parsed.parserErrorsLength(); ++i) {
            const error = parsed.parserErrors(i, tmpError)!;
            const loc = error.textSpan()!;
            decorations.push({
                from: loc.offset(),
                to: loc.offset() + loc.length(),
                decoration: ErrorDecoration,
            });
        }
    }
    if (analyzed !== null) {
        // Analyzer errors
        for (let i = 0; i < analyzed.errorsLength(); ++i) {
            const error = analyzed.errors(i, tmpAnalyzerError)!;
            const loc = error.textSpan();
            if (!loc) continue;
            decorations.push({
                from: loc.offset(),
                to: loc.offset() + loc.length(),
                decoration: ErrorDecoration,
            });
        }
    }

    decorations.sort((l: DecorationInfo, r: DecorationInfo) => {
        return l.from - r.from;
    });
    for (const deco of decorations) {
        builder.add(deco.from, deco.to, deco.decoration);
    }
    return builder.finish();
}

function buildDecorationsFromAnalysis(
    _state: EditorState,
    scriptBuffers: DashQLScriptBuffers,
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const analyzed = scriptBuffers.analyzed?.read() ?? null;
    const decorations: DecorationInfo[] = [];

    if (analyzed !== null) {
        const tokens = scriptBuffers.parsed?.read()?.tokens() ?? null;
        if (tokens) {
            // Decorate unresolved tables
            const tmpTableRef = new dashql.buffers.analyzer.TableReference();
            for (let i = 0; i < analyzed.tableReferencesLength(); ++i) {
                const tableRef = analyzed.tableReferences(i, tmpTableRef)!;
                const span = tableRef.symbolSpan();
                if (!span) continue;
                const ts = dashql.resolveSymbolSpan(tokens, span);
                if (tableRef.resolvedTable() == null) {
                    decorations.push({
                        from: ts.offset,
                        to: ts.offset + ts.length,
                        decoration: UnresolvedTableReferenceDecoration,
                    });
                } else {
                    decorations.push({
                        from: ts.offset,
                        to: ts.offset + ts.length,
                        decoration: ResolvedTableReferenceDecoration,
                    });
                }
            }
            // Decorate unresolved columns
            const tmpColRef = new dashql.buffers.algebra.ColumnRefExpression();
            for (let i = 0; i < analyzed.expressionsLength(); ++i) {
                const expr = analyzed.expressions(i)!;
                if (expr.innerType() == dashql.buffers.algebra.ExpressionSubType.ColumnRefExpression) {
                    const colRef: dashql.buffers.algebra.ColumnRefExpression = expr.inner(tmpColRef)!;
                    const span = expr.symbolSpan();
                    if (!span) continue;
                    const ts = dashql.resolveSymbolSpan(tokens, span);
                    if (colRef.resolvedColumn() == null) {
                        decorations.push({
                            from: ts.offset,
                            to: ts.offset + ts.length,
                            decoration: UnresolvedColumnReferenceDecoration,
                        });
                    } else {
                        decorations.push({
                            from: ts.offset,
                            to: ts.offset + ts.length,
                            decoration: ResolvedColumnReferenceDecoration,
                        });
                    }
                }
            }
        }
    }
    decorations.sort((l: DecorationInfo, r: DecorationInfo) => {
        return l.from - r.from;
    });
    for (const deco of decorations) {
        builder.add(deco.from, deco.to, deco.decoration);
    }
    return builder.finish();
}

function buildDecorationsFromFocus(
    scriptKey: DashQLScriptKey | null,
    scriptBuffers: DashQLScriptBuffers,
    derivedFocus: SemanticUserFocus | null,
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const parsed = scriptBuffers.parsed?.read() ?? null;
    const analyzed = scriptBuffers.analyzed?.read() ?? null;
    const decorations: DecorationInfo[] = [];

    if (parsed === null || analyzed === null) {
        return builder.finish();
    }
    const tmpNamedExpr = new dashql.buffers.algebra.Expression();
    const tmpTblRef = new dashql.buffers.analyzer.TableReference();
    const tmpNode = new dashql.buffers.parser.Node();
    const tokens = scriptBuffers.parsed?.read()?.tokens() ?? null;
    if (!tokens) return builder.finish();

    // Build decorations for column refs of targeting the primary table
    for (const [refId, focusType] of derivedFocus?.scriptColumnRefs ?? []) {
        const externalId = dashql.ExternalObjectID.getOrigin(refId);
        const objectId = dashql.ExternalObjectID.getObject(refId);
        if (externalId !== scriptKey) {
            continue;
        }
        // XXX invalidate focused table refs at write front
        if (objectId >= analyzed.expressionsLength()) {
            continue;
        }
        const expr = analyzed.expressions(objectId, tmpNamedExpr);
        if (expr == null) {
            continue;
        }
        const astNodeId = expr.astNodeId();
        if (astNodeId == null) {
            continue;
        }
        const astNode = parsed.nodes(astNodeId, tmpNode);
        const span = astNode?.symbolSpan() ?? null;
        if (span == null) {
            continue;
        }
        const ts = dashql.resolveSymbolSpan(tokens, span);

        // Get decoration
        let decoration: Decoration;
        switch (focusType) {
            case FocusType.COLUMN_REF_UNDER_CURSOR:
                decoration = CursorColumnReference;
                break;
            default:
                decoration = FocusedColumnReferenceDecoration;
                break;
        }
        decorations.push({
            from: ts.offset,
            to: ts.offset + ts.length,
            decoration: decoration,
        });
    }

    // Build decorations for table refs targeting the primary table
    for (const [refId, focusType] of derivedFocus?.scriptTableRefs ?? []) {
        const externalId = dashql.ExternalObjectID.getOrigin(refId);
        const objectId = dashql.ExternalObjectID.getObject(refId);
        if (externalId !== scriptKey) {
            continue;
        }
        // XXX invalidate focused table refs at write front
        if (objectId >= analyzed.tableReferencesLength()) {
            continue;
        }
        const columnRef = analyzed.tableReferences(objectId, tmpTblRef);
        if (columnRef == null) {
            continue;
        }
        const astNodeId = columnRef.astNodeId();
        if (astNodeId == null) {
            continue;
        }
        const astNode = parsed.nodes(astNodeId, tmpNode);
        const span = astNode?.symbolSpan() ?? null;
        if (span == null) {
            continue;
        }
        const ts = dashql.resolveSymbolSpan(tokens, span);

        // Get decoration
        let decoration: Decoration;
        switch (focusType) {
            case FocusType.TABLE_REF_UNDER_CURSOR:
                decoration = CursorTableReference;
                break;
            default:
                decoration = FocusedTableReferenceDecoration;
                break;
        }
        decorations.push({
            from: ts.offset,
            to: ts.offset + ts.length,
            decoration: decoration,
        });
    }
    decorations.sort((l: DecorationInfo, r: DecorationInfo) => {
        return l.from - r.from;
    });
    for (const deco of decorations) {
        builder.add(deco.from, deco.to, deco.decoration);
    }
    return builder.finish();
}


interface DecorationInfo {
    from: number;
    to: number;
    decoration: Decoration;
}


interface ScriptDecorationState {
    decorations: DecorationSet;
    scriptBuffers: DashQLScriptBuffers;
}

/// Decorations derived from DashQL scanner tokens
const ScannerDecorationField: StateField<ScriptDecorationState> = StateField.define<ScriptDecorationState>({
    // Create the initial state
    create: () => {
        const config: ScriptDecorationState = {
            decorations: new RangeSetBuilder<Decoration>().finish(),
            scriptBuffers: {
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
        };
        return config;
    },
    // Mirror the DashQL state
    update: (state: ScriptDecorationState, transaction: Transaction) => {
        const processor = transaction.state.field(DashQLProcessorPlugin);
        if (processor.scriptBuffers.parsed === state.scriptBuffers.parsed) {
            return state;
        }
        // Rebuild decorations
        const s = { ...state };
        s.scriptBuffers.parsed = processor.scriptBuffers.parsed;
        s.decorations = (new RangeSetBuilder<Decoration>()).finish();
        if (s.scriptBuffers.parsed) {
            s.decorations = buildDecorationsFromTokens(transaction.state, s.scriptBuffers.parsed);
        }
        return s;
    },
});

/// Decorations for scanner, parser or analyzer errors in the DashQL script
const ErrorDecorationField: StateField<ScriptDecorationState> = StateField.define<ScriptDecorationState>({
    create: () => {
        const config: ScriptDecorationState = {
            decorations: new RangeSetBuilder<Decoration>().finish(),
            scriptBuffers: {
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
        };
        return config;
    },
    update: (state: ScriptDecorationState, transaction: Transaction) => {
        // Scanned program untouched?
        const processor = transaction.state.field(DashQLProcessorPlugin);
        if (processor.scriptBuffers === state.scriptBuffers) {
            return state;
        }
        // Rebuild decorations
        const s = { ...state };
        s.scriptBuffers = processor.scriptBuffers;
        s.decorations = buildDecorationsFromErrors(transaction.state, s.scriptBuffers);
        return s;
    },
});

const AnalyzerDecorationsField: StateField<ScriptDecorationState> = StateField.define<ScriptDecorationState>({
    create: () => {
        const config: ScriptDecorationState = {
            decorations: new RangeSetBuilder<Decoration>().finish(),
            scriptBuffers: {
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
        };
        return config;
    },
    update: (state: ScriptDecorationState, transaction: Transaction) => {
        // Scanned program untouched?
        const processor = transaction.state.field(DashQLProcessorPlugin);
        if (processor.scriptBuffers === state.scriptBuffers) {
            return state;
        }
        // Rebuild decorations
        const s = { ...state };
        s.scriptBuffers = processor.scriptBuffers;
        s.decorations = buildDecorationsFromAnalysis(transaction.state, s.scriptBuffers);
        return s;
    },
});

interface FocusDecorationState {
    scriptKey: DashQLScriptKey | null;
    decorations: DecorationSet;
    scriptBuffers: DashQLScriptBuffers;
    scriptCursor: dashql.FlatBufferPtr<dashql.buffers.cursor.ScriptCursor> | null;
    derivedFocus: SemanticUserFocus | null;
}

/// Decorations derived from the user focus
const FocusDecorationField: StateField<FocusDecorationState> = StateField.define<FocusDecorationState>({
    // Create the initial state
    create: () => {
        const config: FocusDecorationState = {
            scriptKey: null,
            decorations: new RangeSetBuilder<Decoration>().finish(),
            scriptBuffers: {
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
            scriptCursor: null,
            derivedFocus: null,
        };
        return config;
    },
    // Mirror the DashQL state
    update: (state: FocusDecorationState, transaction: Transaction) => {
        // Scanned program untouched?
        const processor = transaction.state.field(DashQLProcessorPlugin);
        if (
            processor.scriptKey === state.scriptKey &&
            processor.scriptBuffers.parsed === state.scriptBuffers.parsed &&
            processor.scriptBuffers.analyzed === state.scriptBuffers.analyzed &&
            processor.scriptCursor === state.scriptCursor &&
            processor.derivedFocus === state.derivedFocus
        ) {
            return state;
        }
        // Rebuild decorations
        const s = { ...state };
        s.scriptKey = processor.scriptKey;
        s.scriptBuffers.parsed = processor.scriptBuffers.parsed;
        s.scriptBuffers.analyzed = processor.scriptBuffers.analyzed;
        s.scriptCursor = processor.scriptCursor;
        s.derivedFocus = processor.derivedFocus;
        s.decorations = buildDecorationsFromFocus(
            s.scriptKey,
            s.scriptBuffers,
            s.derivedFocus,
        );
        return s;
    },
});

const ScannerDecorations = EditorView.decorations.from(ScannerDecorationField, state => state.decorations);
const ErrorDecorations = EditorView.decorations.from(ErrorDecorationField, state => state.decorations);
const AnalyzerDecorations = EditorView.decorations.from(AnalyzerDecorationsField, state => state.decorations);
const FocusDecorations = EditorView.decorations.from(FocusDecorationField, state => state.decorations);

export const DashQLScannerDecorationPlugin = [ScannerDecorationField, ScannerDecorations];

/// Bundle the decoration extensions
export const DashQLDecorationPlugin = [ScannerDecorationField, ScannerDecorations, ErrorDecorationField, ErrorDecorations, AnalyzerDecorationsField, AnalyzerDecorations, FocusDecorationField, FocusDecorations];
