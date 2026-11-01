
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
}

/// The catalog entry of the results of scripts, see `TABLE_PARAMETERS_ENTRY_ID` of the core
export const TABLE_PARAMETERS_ENTRY_ID = 0xFFFFFFFE;

export const CANDIDATE_TYPE_SYMBOL_TEXT: string[] = [
    "SQL",
    "DB",
    "NS",
    "TBL",
    "COL",
    "FN",
    "ID",
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
];

export function getCandidateTypeSymbolText(type: CompletionCandidateType) {
    return CANDIDATE_TYPE_SYMBOL_TEXT[type as number];
}

export function getCandidateTypeSymbolColor(type: CompletionCandidateType) {
    return CANDIDATE_TYPE_SYMBOL_BACKGROUND[type as number];
}
