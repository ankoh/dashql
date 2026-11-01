
export enum CompletionCandidateType {
    KEYWORD = 0,
    DATABASE = 1,
    SCHEMA = 2,
    TABLE = 3,
    COLUMN = 4,
    FUNCTION = 5,
    IDENTITY = 6,
    /// The result of a script of the session, a table parameter `:foo`
    SCRIPT = 7,
    /// An attachment of the session, a table parameter `:foo`
    ATTACHMENT = 8,
}

export const CANDIDATE_TYPE_SYMBOL_TEXT: string[] = [
    "SQL",
    "DB",
    "NS",
    "TBL",
    "COL",
    "FN",
    "ID",
    ":",
    ":",
];

export const CANDIDATE_TYPE_SYMBOL_BACKGROUND: string[] = [
    "#aa0d91",
    "#000",
    "#000",
    "#5B18A3",
    "#DD1141",
    "#0E7A00",
    "#666",
    "#0969da",
    "#1a7f37",
];

export function getCandidateTypeSymbolText(type: CompletionCandidateType) {
    return CANDIDATE_TYPE_SYMBOL_TEXT[type as number];
}

export function getCandidateTypeSymbolColor(type: CompletionCandidateType) {
    return CANDIDATE_TYPE_SYMBOL_BACKGROUND[type as number];
}
