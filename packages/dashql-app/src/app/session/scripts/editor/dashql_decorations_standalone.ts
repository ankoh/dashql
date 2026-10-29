import * as dashql from '@ankoh/dashql-core';

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState, Extension, StateEffect, type StateEffectType, StateField, Transaction, RangeSetBuilder } from '@codemirror/state';
import { highlightingFor } from '@codemirror/language';
import { tags as CODEMIRROR_TAGS, Tag } from '@lezer/highlight';

import './dashql_decorations.css';

export const commentTag = CODEMIRROR_TAGS.comment;
const relationNameTag = CODEMIRROR_TAGS.typeName;
const functionNameTag = CODEMIRROR_TAGS.function(CODEMIRROR_TAGS.variableName);

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
]);

const CODEMIRROR_TAGS_USED: Set<Tag> = new Set([commentTag, relationNameTag, functionNameTag]);
for (const [_token, tag] of PROTO_TAG_MAPPING) {
    CODEMIRROR_TAGS_USED.add(tag);
}

/// Build the tag -> decoration lookup for the current editor state (theme dependent).
/// `extraClass` is added to the highlight class of every tag.
function buildTagDecorations(state: EditorState, extraClass: string | null): Map<Tag, Decoration> {
    const decorations: Map<Tag, Decoration> = new Map();
    for (const tag of CODEMIRROR_TAGS_USED) {
        const highlightClass = highlightingFor(state, [tag]) ?? '';
        const classes = [highlightClass, tag === commentTag ? 'dashql-comment' : null, extraClass];
        decorations.set(
            tag,
            Decoration.mark({
                class: classes.filter(c => c).join(' '),
            }),
        );
    }
    return decorations;
}

/// The tag of the comment regions that describe a script, their text reads like prose
const DESCRIPTION_TAG = 'description';

/// A piece of a `@description` region: a line of its text, or the comment markers and tags around them
interface DescriptionPiece {
    from: number;
    to: number;
    text: boolean;
}

/// The pieces of the `@description` regions of an update, sorted by offset
function descriptionPieces(update: dashql.buffers.editor.EditorUpdateT): DescriptionPiece[] {
    const pieces: DescriptionPiece[] = [];
    for (const tag of update.commentTags) {
        if (tag.name !== DESCRIPTION_TAG || tag.textSpan == null) continue;
        let at = Number(tag.textSpan.offset);
        for (const line of tag.lines) {
            const from = Number(line.offset);
            const to = Number(line.offset + line.length);
            if (from > at) pieces.push({ from: at, to: from, text: false });
            pieces.push({ from, to, text: true });
            at = to;
        }
        const end = Number(tag.textSpan.offset + tag.textSpan.length);
        if (end > at) pieces.push({ from: at, to: end, text: false });
    }
    return pieces;
}

/// Build syntax highlighting decorations for the tokens that fall into the given ranges.
///
/// This only touches the tokens overlapping `ranges` (the editor viewport), not the whole
/// document. On a large script decorating every token synchronously blocks the main thread;
/// slicing the sorted portable syntax spans to the viewport keeps it O(visible).
export function buildDecorationsForRanges(
    state: EditorState,
    update: dashql.buffers.editor.EditorUpdateT,
    ranges: readonly { from: number; to: number }[],
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const decorations = buildTagDecorations(state, null);
    // The tokens of `@vis` tags in comments are highlighted quieter than the SQL around them
    const commentTokenDecorations = buildTagDecorations(state, 'dashql-comment-token');
    // The text of a `@description` keeps the color of the text, its comment markers and tags step back
    const descriptionText = Decoration.mark({ class: 'dashql-comment dashql-comment-description' });
    const descriptionMarker = buildTagDecorations(state, 'dashql-comment-tag').get(commentTag)!;
    const pieces = descriptionPieces(update);
    let pieceCursor = 0;
    const addComment = (from: number, to: number, decoration: Decoration) => {
        let at = from;
        while (pieceCursor < pieces.length && pieces[pieceCursor].to <= at) ++pieceCursor;
        for (let i = pieceCursor; i < pieces.length && pieces[i].from < to; ++i) {
            const piece = pieces[i];
            const pieceFrom = Math.max(piece.from, at);
            const pieceTo = Math.min(piece.to, to);
            if (pieceFrom > at) builder.add(at, pieceFrom, decoration);
            builder.add(pieceFrom, pieceTo, piece.text ? descriptionText : descriptionMarker);
            at = pieceTo;
        }
        if (to > at) builder.add(at, to, decoration);
    };
    const semanticNames = update.semanticSpans.filter(semantic =>
        semantic.textSpan != null && (
            semantic.kind === dashql.buffers.editor.EditorSemanticReferenceKind.TABLE ||
            semantic.kind === dashql.buffers.editor.EditorSemanticReferenceKind.FUNCTION
        ),
    );
    let semanticCursor = 0;
    let spanCursor = 0;
    for (const { from, to } of ranges) {
        while (spanCursor < update.syntaxSpans.length) {
            const syntax = update.syntaxSpans[spanCursor];
            const span = syntax.textSpan;
            if (span == null) {
                ++spanCursor;
                continue;
            }
            const spanFrom = Number(span.offset);
            const spanTo = Number(span.offset + span.length);
            if (spanTo <= from) {
                ++spanCursor;
                continue;
            }
            if (spanFrom >= to) break;
            let tag = syntax.tokenType === dashql.buffers.parser.ScannerTokenType.COMMENT
                ? commentTag
                : PROTO_TAG_MAPPING.get(syntax.tokenType);
            if (syntax.tokenType === dashql.buffers.parser.ScannerTokenType.IDENTIFIER) {
                while (semanticCursor < semanticNames.length) {
                    const semanticSpan = semanticNames[semanticCursor].textSpan!;
                    if (Number(semanticSpan.offset + semanticSpan.length) > spanFrom) break;
                    ++semanticCursor;
                }
                const semantic = semanticNames[semanticCursor];
                const semanticSpan = semantic?.textSpan;
                const semanticKind = semanticSpan != null && Number(semanticSpan.offset) <= spanFrom &&
                        Number(semanticSpan.offset + semanticSpan.length) >= spanTo
                    ? semantic.kind
                    : null;
                switch (semanticKind) {
                    case dashql.buffers.editor.EditorSemanticReferenceKind.TABLE:
                        tag = relationNameTag;
                        break;
                    case dashql.buffers.editor.EditorSemanticReferenceKind.FUNCTION:
                        tag = functionNameTag;
                        break;
                }
            }
            const tagDecorations = syntax.inComment && tag !== commentTag ? commentTokenDecorations : decorations;
            if (tag === commentTag) {
                addComment(spanFrom, spanTo, tagDecorations.get(tag)!);
            } else if (tag) {
                builder.add(spanFrom, spanTo, tagDecorations.get(tag)!);
            }
            ++spanCursor;
        }
    }
    return builder.finish();
}

/// A ViewPlugin that highlights only the visible tokens.
///
/// `getUpdate` resolves the portable editor projection for the current view: the integrated editor reads it
/// from the processor state field, the standalone preview from an effect-backed field. Decorations
/// are recomputed when the viewport scrolls, the document changes, or the projection is swapped.
export function createScannerHighlightPlugin(
    getUpdate: (view: EditorView) => dashql.buffers.editor.EditorUpdateT | null,
): Extension {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            lastUpdate: dashql.buffers.editor.EditorUpdateT | null;

            constructor(view: EditorView) {
                this.lastUpdate = getUpdate(view);
                this.decorations = this.lastUpdate
                    ? buildDecorationsForRanges(view.state, this.lastUpdate, view.visibleRanges)
                    : Decoration.none;
                console.debug('[session-editor-debug] initialized syntax highlighting', {
                    hasProjection: this.lastUpdate != null,
                    textVersion: this.lastUpdate?.textVersion,
                    stateRevision: this.lastUpdate?.stateRevision,
                    syntaxSpanCount: this.lastUpdate?.syntaxSpans.length ?? 0,
                    semanticSpanCount: this.lastUpdate?.semanticSpans.length ?? 0,
                    visibleRanges: view.visibleRanges.map(range => `${range.from}-${range.to}`).join(','),
                    documentLength: view.state.doc.length,
                    decorationCount: this.decorations.size,
                });
            }
            update(u: ViewUpdate) {
                const update = getUpdate(u.view);
                // An update that omits an unchanged analysis keeps the spans
                const projectionChanged = update?.syntaxSpans !== this.lastUpdate?.syntaxSpans
                    || update?.semanticSpans !== this.lastUpdate?.semanticSpans;
                if (u.viewportChanged || u.docChanged || projectionChanged) {
                    this.lastUpdate = update;
                    this.decorations = update
                        ? buildDecorationsForRanges(u.view.state, update, u.view.visibleRanges)
                        : Decoration.none;
                    console.debug('[session-editor-debug] rebuilt syntax highlighting', {
                        hasProjection: update != null,
                        projectionChanged,
                        viewportChanged: u.viewportChanged,
                        docChanged: u.docChanged,
                        textVersion: update?.textVersion,
                        stateRevision: update?.stateRevision,
                        syntaxSpanCount: update?.syntaxSpans.length ?? 0,
                        semanticSpanCount: update?.semanticSpans.length ?? 0,
                        visibleRanges: u.view.visibleRanges.map(range => `${range.from}-${range.to}`).join(','),
                        documentLength: u.view.state.doc.length,
                        decorationCount: this.decorations.size,
                    });
                }
            }
        },
        { decorations: v => v.decorations },
    );
}

export const DashQLScannerDecorationUpdateEffect: StateEffectType<dashql.buffers.editor.EditorUpdateT | null> =
    StateEffect.define<dashql.buffers.editor.EditorUpdateT | null>();

/// Holds the editor projection pushed in from outside via DashQLScannerDecorationUpdateEffect.
/// The highlight ViewPlugin reads it back out to decorate the viewport.
const StandaloneUpdateField: StateField<dashql.buffers.editor.EditorUpdateT | null> =
    StateField.define<dashql.buffers.editor.EditorUpdateT | null>({
        create: () => null,
        update: (update, transaction: Transaction) => {
            for (const effect of transaction.effects) {
                if (effect.is(DashQLScannerDecorationUpdateEffect)) {
                    update = effect.value;
                }
            }
            return update;
        },
    });

export const DashQLStandaloneScannerDecorationPlugin = [
    StandaloneUpdateField,
    createScannerHighlightPlugin(view => view.state.field(StandaloneUpdateField)),
];
