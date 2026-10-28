/// The character that starts a script reference in natural language, e.g. "@revenue"
export const SCRIPT_REFERENCE_PREFIX = '@';

/// A character that continues a script name, a reference must not be followed by one
const NAME_CHAR = /[\p{L}\p{N}_$-]/u;

/// A reference to a session script in natural language text
export interface ScriptReference {
    /// The begin of the reference, at the prefix
    from: number;
    /// The end of the reference
    to: number;
    /// The display name of the referenced script
    name: string;
}

/// Render the reference of a script
export function renderScriptReference(name: string): string {
    return `${SCRIPT_REFERENCE_PREFIX}${name}`;
}

/// Find the references to session scripts in a text.
/// A reference is the prefix followed by the display name of a script, the longest name wins.
/// Names compare case-insensitively, the prefix must not be part of a word (an email address).
export function findScriptReferences(names: readonly string[], text: string): ScriptReference[] {
    const references: ScriptReference[] = [];
    if (names.length === 0) {
        return references;
    }
    const lowerText = text.toLowerCase();
    const candidates = names
        .map(name => ({ name, lower: name.toLowerCase() }))
        .sort((l, r) => r.lower.length - l.lower.length);
    for (let at = text.indexOf(SCRIPT_REFERENCE_PREFIX); at >= 0; at = text.indexOf(SCRIPT_REFERENCE_PREFIX, at + 1)) {
        if (at > 0 && NAME_CHAR.test(text[at - 1])) {
            continue;
        }
        const begin = at + SCRIPT_REFERENCE_PREFIX.length;
        const match = candidates.find(candidate => candidate.lower.length > 0
            && lowerText.startsWith(candidate.lower, begin)
            && !NAME_CHAR.test(text[begin + candidate.lower.length] ?? ''));
        if (match == null) {
            continue;
        }
        references.push({ from: at, to: begin + match.lower.length, name: match.name });
        at = begin + match.lower.length - 1;
    }
    return references;
}

/// The distinct names of the scripts that a text references, in the order of their first reference
export function collectReferencedScripts(names: readonly string[], text: string): string[] {
    return [...new Set(findScriptReferences(names, text).map(reference => reference.name))];
}
