import * as sqlynx from '@ankoh/sqlynx-core';

import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { SQLynxProcessor } from './sqlynx_processor.js';
import { getNameTagName, unpackNameTags } from '../../utils/index.js';

function updateCompletions(
    _current: CompletionResult,
    _from: number,
    _to: number,
    _context: CompletionContext,
): CompletionResult | null {
    return null;
}

/// Derived from this example:
/// https://codemirror.net/examples/autocompletion/
export async function completeSQLynx(context: CompletionContext): Promise<CompletionResult> {
    const processor = context.state.field(SQLynxProcessor);
    const options: Completion[] = [];

    let offset = context.pos;
    if (processor.targetScript !== null && processor.scriptCursor !== null) {
        const relativePos = processor.scriptCursor.scannerRelativePosition;
        const performCompletion =
            relativePos == sqlynx.proto.RelativeSymbolPosition.BEGIN_OF_SYMBOL ||
            relativePos == sqlynx.proto.RelativeSymbolPosition.MID_OF_SYMBOL ||
            relativePos == sqlynx.proto.RelativeSymbolPosition.END_OF_SYMBOL;
        if (performCompletion) {
            const completionBuffer = processor.targetScript.completeAtCursor(32);
            const completion = completionBuffer.read();
            const candidateObj = new sqlynx.proto.CompletionCandidate();
            for (let i = 0; i < completion.candidatesLength(); ++i) {
                const candidate = completion.candidates(i, candidateObj)!;
                let tagName: string | undefined = undefined;
                for (const tag of unpackNameTags(candidate.combinedTags())) {
                    tagName = getNameTagName(tag);
                    break;
                }
                let candidateDetail = tagName;
                if (processor.config.showCompletionDetails) {
                    candidateDetail = `${candidateDetail}, score=${candidate.score()}, near=${candidate.nearCursor()}`;
                }
                options.push({
                    label: candidate.completionText() ?? '',
                    detail: candidateDetail,
                });
            }
            offset = processor.scriptCursor.scannerSymbolOffset;
        }
    }

    return {
        from: offset,
        options,
        filter: false,
        update: updateCompletions,
    };
}
