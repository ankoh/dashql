import * as dashql from '../../core/index.js';

import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { EditorState, StateEffect, type StateEffectType, StateField, Transaction, RangeSetBuilder } from '@codemirror/state';
import { highlightingFor } from '@codemirror/language';
import { tags as CODEMIRROR_TAGS, Tag } from '@lezer/highlight';

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

export function buildDecorationsFromTokens(
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

interface ScannerDecorationOnlyState {
    decorations: DecorationSet;
    scanned: dashql.FlatBufferPtr<dashql.buffers.parser.ScannedScript> | null;
}

export const DashQLScannerDecorationUpdateEffect: StateEffectType<dashql.FlatBufferPtr<dashql.buffers.parser.ScannedScript> | null> =
    StateEffect.define<dashql.FlatBufferPtr<dashql.buffers.parser.ScannedScript> | null>();

const StandaloneScannerDecorationField: StateField<ScannerDecorationOnlyState> = StateField.define<ScannerDecorationOnlyState>({
    create: () => ({
        decorations: new RangeSetBuilder<Decoration>().finish(),
        scanned: null,
    }),
    update: (state: ScannerDecorationOnlyState, transaction: Transaction) => {
        let scanned = state.scanned;
        for (const effect of transaction.effects) {
            if (effect.is(DashQLScannerDecorationUpdateEffect)) {
                scanned = effect.value;
            }
        }
        if (scanned === state.scanned) {
            return state;
        }
        return {
            scanned,
            decorations: scanned == null
                ? new RangeSetBuilder<Decoration>().finish()
                : buildDecorationsFromTokens(transaction.state, scanned),
        };
    },
});

const StandaloneScannerDecorations = EditorView.decorations.from(StandaloneScannerDecorationField, state => state.decorations);

export const DashQLStandaloneScannerDecorationPlugin = [StandaloneScannerDecorationField, StandaloneScannerDecorations];
