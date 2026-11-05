
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

/// The badge colors of the candidate types, emphasis colors of the theme that carry white text in both schemes
export const CANDIDATE_TYPE_SYMBOL_BACKGROUND: string[] = [
    "var(--color_done_emphasis)",
    "var(--color_neutral_emphasis)",
    "var(--color_neutral_emphasis)",
    "var(--color_accent_emphasis)",
    "var(--color_danger_emphasis)",
    "var(--color_success_emphasis)",
    "var(--color_neutral_emphasis)",
    "var(--color_accent_emphasis)",
    "var(--color_success_emphasis)",
];

export function getCandidateTypeSymbolText(type: CompletionCandidateType) {
    return CANDIDATE_TYPE_SYMBOL_TEXT[type as number];
}

export function getCandidateTypeSymbolColor(type: CompletionCandidateType) {
    return CANDIDATE_TYPE_SYMBOL_BACKGROUND[type as number];
}
