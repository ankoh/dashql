import * as dashql from '@ankoh/dashql-core';

const CANDIDATE_OBJECT_TYPE_SYMBOL_TEXT: string[] = [
    "SQL",
    "DB",
    "NS",
    "TBL",
    "COL",
];

const CANDIDATE_OBJECT_TYPE_SYMBOL_BACKGROUND: string[] = [
    "#aa0d91",
    "black",
    "black",
    "black",
    "black",
];

export function getObjectTypeSymbolText(type: dashql.buffers.completion.CompletionCandidateObjectType) {
    return CANDIDATE_OBJECT_TYPE_SYMBOL_TEXT[type as number];
}

export function getObjectTypeSymbolColor(type: dashql.buffers.completion.CompletionCandidateObjectType) {
    return CANDIDATE_OBJECT_TYPE_SYMBOL_BACKGROUND[type as number];
}
