/// A statement of a SQL text
export interface SqlStatement {
    /// The text of the statement, without the comments before it, the surrounding whitespace and the semicolon
    readonly text: string;
    /// The line of its first character in the whole text, counted from 1
    readonly line: number;
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_$\u0080-￿]/;
const WHITESPACE = /\s/;
const DOLLAR_QUOTE_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;

/// Split a SQL text into its statements at the semicolons outside of literals, quoted identifiers and comments.
/// Hyper runs one statement per call, so the command splits a file itself. Statements of only whitespace and comments
/// are left out. An unterminated literal or comment runs to the end of the text, the engine then reports the error.
export function splitStatements(sql: string): SqlStatement[] {
    const statements: SqlStatement[] = [];
    let line = 1;
    let statementStart = -1;
    let statementLine = 1;
    let previousIsIdentifier = false;
    let i = 0;

    const advanceTo = (end: number) => {
        for (let j = i; j < end; ++j) {
            if (sql[j] === '\n') ++line;
        }
        i = end;
    };
    const markContent = () => {
        if (statementStart < 0) {
            statementStart = i;
            statementLine = line;
        }
    };
    const finishStatement = (end: number) => {
        if (statementStart >= 0) {
            statements.push({ text: sql.slice(statementStart, end).trim(), line: statementLine });
        }
        statementStart = -1;
    };
    /// The end of a quoted text that starts at i, after its closing quote
    const quotedEnd = (quote: string, backslashEscapes: boolean): number => {
        let j = i + 1;
        while (j < sql.length) {
            const c = sql[j];
            if (backslashEscapes && c === '\\') {
                j += 2;
            } else if (c === quote) {
                if (sql[j + 1] === quote) {
                    j += 2;
                } else {
                    return j + 1;
                }
            } else {
                ++j;
            }
        }
        return sql.length;
    };

    while (i < sql.length) {
        const c = sql[i];
        const next = sql[i + 1];

        if (c === '-' && next === '-') {
            const lineEnd = sql.indexOf('\n', i + 2);
            advanceTo(lineEnd < 0 ? sql.length : lineEnd);
            previousIsIdentifier = false;
        } else if (c === '/' && next === '*') {
            // Block comments nest, as in Postgres
            let depth = 1;
            let j = i + 2;
            while (j < sql.length && depth > 0) {
                if (sql[j] === '/' && sql[j + 1] === '*') {
                    ++depth;
                    j += 2;
                } else if (sql[j] === '*' && sql[j + 1] === '/') {
                    --depth;
                    j += 2;
                } else {
                    ++j;
                }
            }
            advanceTo(j);
            previousIsIdentifier = false;
        } else if (c === ';') {
            finishStatement(i);
            advanceTo(i + 1);
            previousIsIdentifier = false;
        } else if (WHITESPACE.test(c)) {
            advanceTo(i + 1);
            previousIsIdentifier = false;
        } else {
            markContent();
            if (c === "'") {
                advanceTo(quotedEnd("'", false));
                previousIsIdentifier = false;
            } else if ((c === 'E' || c === 'e') && next === "'" && !previousIsIdentifier) {
                advanceTo(i + 1);
                advanceTo(quotedEnd("'", true));
                previousIsIdentifier = false;
            } else if (c === '"') {
                advanceTo(quotedEnd('"', false));
                previousIsIdentifier = true;
            } else if (c === '$' && !previousIsIdentifier && DOLLAR_QUOTE_TAG.test(sql.slice(i, i + 256))) {
                const tag = DOLLAR_QUOTE_TAG.exec(sql.slice(i, i + 256))![0];
                const close = sql.indexOf(tag, i + tag.length);
                advanceTo(close < 0 ? sql.length : close + tag.length);
                previousIsIdentifier = false;
            } else {
                previousIsIdentifier = IDENTIFIER_CHAR.test(c);
                advanceTo(i + 1);
            }
        }
    }
    finishStatement(sql.length);
    return statements;
}
