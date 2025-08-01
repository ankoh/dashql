import * as dashql from '@ankoh/dashql-core';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { EditorState, Transaction, StateField, RangeSetBuilder } from '@codemirror/state';
import { highlightingFor } from '@codemirror/language';
import { tags as CODEMIRROR_TAGS, Tag } from '@lezer/highlight';

import { DashQLProcessor, DashQLScriptBuffers, DashQLScriptKey } from './dashql_processor.js';
import { FocusType, UserFocus } from '../../workbook/focus.js';

import './dashql_decorations.css';

const PROTO_TAG_MAPPING: Map<dashql.buffers.parser.ScannerTokenType, Tag> = new Map([
    [dashql.buffers.parser.ScannerTokenType.KEYWORD, CODEMIRROR_TAGS.keyword],
    [dashql.buffers.parser.ScannerTokenType.OPERATOR, CODEMIRROR_TAGS.operator],
    [dashql.buffers.parser.ScannerTokenType.LITERAL_BINARY, CODEMIRROR_TAGS.literal],
    [dashql.buffers.parser.ScannerTokenType.LITERAL_BOOLEAN, CODEMIRROR_TAGS.bool],
    [dashql.buffers.parser.ScannerTokenType.LITERAL_FLOAT, CODEMIRROR_TAGS.float],
    [dashql.buffers.parser.ScannerTokenType.LITERAL_HEX, CODEMIRROR_TAGS.number],
    [dashql.buffers.parser.ScannerTokenType.LITERAL_STRING, CODEMIRROR_TAGS.string],
    [dashql.buffers.parser.ScannerTokenType.LITERAL_INTEGER, CODEMIRROR_TAGS.integer],
    [dashql.buffers.parser.ScannerTokenType.IDENTIFIER, CODEMIRROR_TAGS.name],
    [dashql.buffers.parser.ScannerTokenType.COMMENT, CODEMIRROR_TAGS.comment],
]);
const CODEMIRROR_TAGS_USED: Set<Tag> = new Set();
for (const [_token, tag] of PROTO_TAG_MAPPING) {
    CODEMIRROR_TAGS_USED.add(tag);
}

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

function buildDecorationsFromTokens(
    state: EditorState,
    scanned: dashql.FlatBufferPtr<dashql.buffers.parser.ScannedScript>,
    tmp: dashql.buffers.parser.ScannedScript = new dashql.buffers.parser.ScannedScript(),
): DecorationSet {
    const decorations: Map<Tag, Decoration> = new Map();
    for (const tag of CODEMIRROR_TAGS_USED) {
        decorations.set(
            tag,
            Decoration.mark({
                class: highlightingFor(state, [tag]) ?? '',
            }),
        );
    }

    const builder = new RangeSetBuilder<Decoration>();
    const scan = scanned.read(tmp);
    const tokens = scan.tokens();
    if (tokens && tokens.tokenOffsetsArray()) {
        const tokenOffsets = tokens.tokenOffsetsArray()!;
        const tokenLengths = tokens.tokenLengthsArray()!;
        const tokenTypes = tokens.tokenTypesArray()!;
        for (let i = 0; i < tokenOffsets.length; ++i) {
            const offset = tokenOffsets[i];
            const length = tokenLengths[i];
            const tag = PROTO_TAG_MAPPING.get(tokenTypes[i]);
            if (tag) {
                const decoration = decorations.get(tag)!;
                builder.add(offset, offset + length, decoration);
            }
        }
    }
    return builder.finish();
}

function buildDecorationsFromErrors(
    _state: EditorState,
    scriptBuffers: DashQLScriptBuffers,
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const decorations: DecorationInfo[] = [];

    const scanned = scriptBuffers.scanned?.read() ?? null;
    const parsed = scriptBuffers.parsed?.read() ?? null;
    const analyzed = scriptBuffers.analyzed?.read() ?? null;

    const tmpLoc = new dashql.buffers.parser.Location();
    const tmpError = new dashql.buffers.parser.Error();
    const tmpAnalyzerError = new dashql.buffers.analyzer.AnalyzerError();

    // Are there any scanner errors?
    if (scanned != null) {
        for (let i = 0; i < scanned.errorsLength(); ++i) {
            const error = scanned.errors(i, tmpError)!;
            const loc = error.location(tmpLoc)!;
            decorations.push({
                from: loc.offset(),
                to: loc.offset() + loc.length(),
                decoration: ErrorDecoration,
            });
        }
    }
    // Are there any parser errors?
    if (parsed !== null) {
        for (let i = 0; i < parsed.errorsLength(); ++i) {
            const error = parsed.errors(i, tmpError)!;
            const loc = error.location(tmpLoc)!;
            decorations.push({
                from: loc.offset(),
                to: loc.offset() + loc.length(),
                decoration: ErrorDecoration,
            });
        }
    }
    if (analyzed !== null) {
        // Are there any analyzer errors?
        for (let i = 0; i < analyzed.errorsLength(); ++i) {
            const error = analyzed.errors(i, tmpAnalyzerError)!;
            const loc = error.location(tmpLoc)!;
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
        // Decorate unresolved tables
        const tmpTableRef = new dashql.buffers.analyzer.TableReference();
        for (let i = 0; i < analyzed.tableReferencesLength(); ++i) {
            const tableRef = analyzed.tableReferences(i, tmpTableRef)!;
            const loc = tableRef.location()!;
            if (tableRef.resolvedTable() == null) {
                decorations.push({
                    from: loc.offset(),
                    to: loc.offset() + loc.length(),
                    decoration: UnresolvedTableReferenceDecoration,
                });
            } else {
                decorations.push({
                    from: loc.offset(),
                    to: loc.offset() + loc.length(),
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
                const loc = expr.location()!;
                if (colRef.resolvedColumn() == null) {
                    decorations.push({
                        from: loc.offset(),
                        to: loc.offset() + loc.length(),
                        decoration: UnresolvedColumnReferenceDecoration,
                    });
                } else {
                    decorations.push({
                        from: loc.offset(),
                        to: loc.offset() + loc.length(),
                        decoration: ResolvedColumnReferenceDecoration,
                    });
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
    derivedFocus: UserFocus | null,
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
    const tmpLoc = new dashql.buffers.parser.Location();

    // Build decorations for column refs of targeting the primary table
    for (const [refId, focusType] of derivedFocus?.scriptColumnRefs ?? []) {
        const externalId = dashql.ContextObjectID.getContext(refId);
        const objectId = dashql.ContextObjectID.getObject(refId);
        if (externalId !== scriptKey) {
            continue;
        }
        // XXX invalidate focused table refs at write front
        if (objectId >= analyzed.expressionsLength()) {
            continue;
        }
        const expr = analyzed.expressions(objectId, tmpNamedExpr)!;
        const astNodeId = expr.astNodeId()!;
        const astNode = parsed.nodes(astNodeId, tmpNode)!;
        const loc = astNode.location(tmpLoc)!;

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
            from: loc.offset(),
            to: loc.offset() + loc.length(),
            decoration: decoration, // XXX more specific
        });
    }

    // Build decorations for table refs targeting the primary table
    for (const [refId, focusType] of derivedFocus?.scriptTableRefs ?? []) {
        const externalId = dashql.ContextObjectID.getContext(refId);
        const objectId = dashql.ContextObjectID.getObject(refId);
        if (externalId !== scriptKey) {
            continue;
        }
        // XXX invalidate focused table refs at write front
        if (objectId >= analyzed.tableReferencesLength()) {
            continue;
        }
        const columnRef = analyzed.tableReferences(objectId, tmpTblRef)!;
        const astNodeId = columnRef.astNodeId()!;
        const astNode = parsed.nodes(astNodeId, tmpNode)!;
        const loc = astNode.location(tmpLoc)!;

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
            from: loc.offset(),
            to: loc.offset() + loc.length(),
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
                scanned: null,
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
        };
        return config;
    },
    // Mirror the DashQL state
    update: (state: ScriptDecorationState, transaction: Transaction) => {
        // Scanned program untouched?
        const processor = transaction.state.field(DashQLProcessor);
        if (processor.scriptBuffers.scanned === state.scriptBuffers.scanned) {
            return state;
        }
        // Rebuild decorations
        const s = { ...state };
        s.scriptBuffers.scanned = processor.scriptBuffers.scanned;
        s.decorations = (new RangeSetBuilder<Decoration>()).finish();
        if (s.scriptBuffers.scanned) {
            s.decorations = buildDecorationsFromTokens(transaction.state, s.scriptBuffers.scanned);
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
                scanned: null,
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
        };
        return config;
    },
    update: (state: ScriptDecorationState, transaction: Transaction) => {
        // Scanned program untouched?
        const processor = transaction.state.field(DashQLProcessor);
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
                scanned: null,
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
        };
        return config;
    },
    update: (state: ScriptDecorationState, transaction: Transaction) => {
        // Scanned program untouched?
        const processor = transaction.state.field(DashQLProcessor);
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
    derivedFocus: UserFocus | null;
}

/// Decorations derived from the user focus
const FocusDecorationField: StateField<FocusDecorationState> = StateField.define<FocusDecorationState>({
    // Create the initial state
    create: () => {
        const config: FocusDecorationState = {
            scriptKey: null,
            decorations: new RangeSetBuilder<Decoration>().finish(),
            scriptBuffers: {
                scanned: null,
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
        const processor = transaction.state.field(DashQLProcessor);
        if (
            processor.scriptKey === state.scriptKey &&
            processor.scriptBuffers.scanned === state.scriptBuffers.scanned &&
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
        s.scriptBuffers.scanned = processor.scriptBuffers.scanned;
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

/// Bundle the decoration extensions
export const DashQLDecorations = [ScannerDecorationField, ScannerDecorations, ErrorDecorationField, ErrorDecorations, AnalyzerDecorationsField, AnalyzerDecorations, FocusDecorationField, FocusDecorations];
