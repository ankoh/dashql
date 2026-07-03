import * as dashql from '../../core/index.js';

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState, Extension, StateEffect, type StateEffectType, StateField, Transaction, RangeSetBuilder } from '@codemirror/state';
import { highlightingFor } from '@codemirror/language';
import { tags as CODEMIRROR_TAGS, Tag } from '@lezer/highlight';

import './dashql_decorations.css';

export const visKeywordTag = Tag.define(CODEMIRROR_TAGS.keyword);

const PROTO_TAG_MAPPING: Map<dashql.buffers.parser.ScannerTokenType, Tag> = new Map([
    [dashql.buffers.parser.ScannerTokenType.KEYWORD, CODEMIRROR_TAGS.keyword],
    [dashql.buffers.parser.ScannerTokenType.KEYWORD_VIS, visKeywordTag],
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

/// Build the tag -> decoration lookup for the current editor state (theme dependent).
function buildTagDecorations(state: EditorState): Map<Tag, Decoration> {
    const decorations: Map<Tag, Decoration> = new Map();
    for (const tag of CODEMIRROR_TAGS_USED) {
        decorations.set(
            tag,
            Decoration.mark({
                class: highlightingFor(state, [tag]) ?? '',
            }),
        );
    }
    return decorations;
}

/// Build syntax highlighting decorations for the tokens that fall into the given ranges.
///
/// This only touches the tokens overlapping `ranges` (the editor viewport), not the whole
/// document. On a large script decorating every token synchronously blocks the main thread;
/// slicing to the viewport via the binary-searched `findTokensInRange` keeps it O(visible).
export function buildDecorationsForRanges(
    state: EditorState,
    parsed: dashql.FlatBufferPtr<dashql.buffers.parser.ParsedScript>,
    ranges: readonly { from: number; to: number }[],
    tmp: dashql.buffers.parser.ParsedScript = new dashql.buffers.parser.ParsedScript(),
): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const script = parsed.read(tmp);
    const tokens = script.tokens();
    if (!tokens || !tokens.tokenOffsetsArray()) {
        return builder.finish();
    }
    const decorations = buildTagDecorations(state);
    const tokenOffsets = tokens.tokenOffsetsArray()!;
    const tokenLengths = tokens.tokenLengthsArray()!;
    const tokenTypes = tokens.tokenTypesArray()!;

    // RangeSetBuilder requires strictly ascending `from`. Ranges are sorted ascending and tokens
    // are sorted by offset, but `findTokensInRange` backs up to include a token straddling the
    // range start, so adjacent ranges can revisit the same token. `cursor` guards against emitting
    // a token index twice (only relevant with folded gaps; the plain editor has a single range).
    let cursor = 0;
    for (const { from, to } of ranges) {
        let [lb, ub] = dashql.findTokensInRange(tokens, from, to);
        if (lb < cursor) {
            lb = cursor;
        }
        for (let i = lb; i < ub; ++i) {
            const tag = PROTO_TAG_MAPPING.get(tokenTypes[i]);
            if (tag) {
                const offset = tokenOffsets[i];
                const length = tokenLengths[i];
                builder.add(offset, offset + length, decorations.get(tag)!);
            }
        }
        if (ub > cursor) {
            cursor = ub;
        }
    }
    return builder.finish();
}

/// A ViewPlugin that highlights only the visible tokens.
///
/// `getParsed` resolves the parsed script for the current view: the integrated editor reads it
/// from the processor state field, the standalone preview from an effect-backed field. Decorations
/// are recomputed when the viewport scrolls, the document changes, or the parsed buffer is swapped.
export function createScannerHighlightPlugin(
    getParsed: (view: EditorView) => dashql.FlatBufferPtr<dashql.buffers.parser.ParsedScript> | null,
): Extension {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            lastParsed: dashql.FlatBufferPtr<dashql.buffers.parser.ParsedScript> | null;

            constructor(view: EditorView) {
                this.lastParsed = getParsed(view);
                this.decorations = this.lastParsed
                    ? buildDecorationsForRanges(view.state, this.lastParsed, view.visibleRanges)
                    : Decoration.none;
            }
            update(u: ViewUpdate) {
                const parsed = getParsed(u.view);
                if (u.viewportChanged || u.docChanged || parsed !== this.lastParsed) {
                    this.lastParsed = parsed;
                    this.decorations = parsed
                        ? buildDecorationsForRanges(u.view.state, parsed, u.view.visibleRanges)
                        : Decoration.none;
                }
            }
        },
        { decorations: v => v.decorations },
    );
}

export const DashQLScannerDecorationUpdateEffect: StateEffectType<dashql.FlatBufferPtr<dashql.buffers.parser.ParsedScript> | null> =
    StateEffect.define<dashql.FlatBufferPtr<dashql.buffers.parser.ParsedScript> | null>();

/// Holds the parsed script pushed in from outside via DashQLScannerDecorationUpdateEffect.
/// The highlight ViewPlugin reads it back out to decorate the viewport.
const StandaloneParsedField: StateField<dashql.FlatBufferPtr<dashql.buffers.parser.ParsedScript> | null> =
    StateField.define<dashql.FlatBufferPtr<dashql.buffers.parser.ParsedScript> | null>({
        create: () => null,
        update: (parsed, transaction: Transaction) => {
            for (const effect of transaction.effects) {
                if (effect.is(DashQLScannerDecorationUpdateEffect)) {
                    parsed = effect.value;
                }
            }
            return parsed;
        },
    });

export const DashQLStandaloneScannerDecorationPlugin = [
    StandaloneParsedField,
    createScannerHighlightPlugin(view => view.state.field(StandaloneParsedField)),
];
