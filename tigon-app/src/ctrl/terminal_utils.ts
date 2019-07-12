// ---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
// ---------------------------------------------------------------------------
// Kudos go to Ioannis Charalampidis.
// Parts of this file were heavily inspired by his local-echo example.
// ---------------------------------------------------------------------------

/// Detects all the word boundaries on the given input
export function wordBoundaries(input: string, leftSide: boolean = true) {
    let match;
    let words = new Array<number>();
    let rx = /\w+/g;
    while ((match = rx.exec(input))) {
        if (leftSide) {
            words.push(match.index);
        } else {
            words.push(match.index + match[0].length);
        }
    }
    return words;
}

/// The closest left word boundary of the given input at the given offset
export function closestLeftBoundary(input: string, offset: number) {
    let found = wordBoundaries(input, true)
        .reverse()
        .find(x => x < offset);
    return found == null ? 0 : found;
}

/// The closest right word boundary of the given input at the given offset
export function closestRightBoundary(input: string, offset: number) {
    let found = wordBoundaries(input, false).find(x => x > offset);
    return found == null ? input.length : found;
}

/// Convert offset at the given input to col/row location
/// 
/// This function is not optimized and practically emulates via brute-force
/// the navigation on the terminal, wrapping when they reach the column width.
export function offsetToColRow(input: string, offset: number, maxCols: number) {
    let row = 0, col = 0;
    for (let i = 0; i < offset; ++i) {
        if (input.charAt(i) === "\n") {
            col = 0;
            row += 1;
        } else {
            col += 1;
            if (col > maxCols) {
                col = 0;
                row += 1;
            }
        }
    }
    return { row, col };
}

/// Counts the lines in the given input
export function countLines(input: string, maxCols: number) {
  return offsetToColRow(input, input.length, maxCols).row + 1;
}

/// Checks if there is an incomplete input
/// 
/// An incomplete input is considered:
/// - An input that contains unterminated single quotes
/// - An input that contains unterminated double quotes
/// - An input that ends with "\"
export function isIncompleteInput(input: string) {
    // Empty input is not incomplete
    if (input.trim() === "") {
        return false;
    }
    // Check for dangling single-quote strings
    if ((input.match(/'/g) || []).length % 2 !== 0) {
        return true;
    }
    // Check for dangling double-quote strings
    if ((input.match(/"/g) || []).length % 2 !== 0) {
        return true;
    }
    // Check for tailing slash
    if (input.endsWith("\\") && !input.endsWith("\\\\")) {
        return true;
    }
    return false;
}

/// Returns true if the expression ends on a tailing whitespace
export function hasTailingWhitespace(input: string) {
    return input.match(/[^\\][ \t]$/m) != null;
}


