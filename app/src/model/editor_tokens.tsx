import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import * as model from '../model';

export enum HighlightingTokenType {
    NONE = 0,
    KEYWORD = 1,
    LITERAL_INTEGER = 2,
    LITERAL_FLOAT = 3,
    LITERAL_STRING = 4,
    LITERAL_BINARY = 5,
    LITERAL_HEX = 6,
    LITERAL_BOOLEAN = 7,
    OPERATOR = 8,
    IDENTIFIER = 9,
    COMMENT = 10,
    DSON_KEY = 11,
}

/** Dummy state to propagate the line number through the TokensProvider API.
 *  We rely on the fact here that the model passes this state from line to line sequentially.
 *  Ref: https://microsoft.github.io/monaco-editor/api/interfaces/monaco.languages.istate.html
 *
 *  This is hacky but the tokenize() function gets a single string as input instead of a line number.
 *  That is super useless to us since we already have all the tokens.
 */
class TokensProviderState implements monaco.languages.IState {
    /** Constructor */
    constructor(protected _lineNumber: number = -1) {}
    /** Get the line number */
    public get lineNumber() {
        return this._lineNumber;
    }
    public advance() {
        this._lineNumber += 1;
    }
    /** Equality check */
    equals(other: TokensProviderState) {
        return this._lineNumber == other._lineNumber;
    }
    /** Clone the state */
    clone() {
        return new TokensProviderState(this._lineNumber);
    }
}

export class TokensProvider implements monaco.languages.TokensProvider {
    /// The redux store
    _program: () => model.Program;

    constructor(program: () => model.Program) {
        this._program = program;
    }

    getInitialState(): monaco.languages.IState {
        return new TokensProviderState();
    }

    tokenize(line: string, state: TokensProviderState): monaco.languages.ILineTokens {
        state.advance();
        const result: monaco.languages.ILineTokens = {
            tokens: [],
            endState: state,
        };
        // Nothing to do?
        const program = this._program();
        if (!program) return result;

        // Get highlighting data
        const buffer = program.ast;
        const hl = buffer?.highlighting();
        if (!hl) return result;

        // Line break valid?
        const tokenBreaks = hl.tokenBreaksArray() ?? new Uint32Array();
        const tokenOffsets = hl.tokenOffsetsArray();
        const tokenTypes = hl.tokenTypesArray();
        if (!tokenOffsets || !tokenTypes) {
            return result;
        }

        // Resolve token range & lineOffset
        // breaks[0] refers to the offset of the first token after linebreak 0
        const tokenBegin = state.lineNumber == 0 ? 0 : tokenBreaks[state.lineNumber - 1];
        const tokenEnd = state.lineNumber < tokenBreaks.length ? tokenBreaks[state.lineNumber] : tokenOffsets.length;

        // Resolve line offset
        let lineOffset = 0;
        if (state.lineNumber > 0) {
            const prevLineBreak = buffer?.lineBreaks(state.lineNumber - 1);
            lineOffset = prevLineBreak ? prevLineBreak.offset() + prevLineBreak.length() : 0;
        }

        // Read all tokens
        for (let i = tokenBegin; i < tokenEnd; ++i) {
            const token = {
                startIndex: tokenOffsets[i] - lineOffset,
                scopes: '',
            };
            switch (tokenTypes[i] as HighlightingTokenType) {
                case HighlightingTokenType.KEYWORD:
                    token.scopes = 'keyword';
                    break;
                case HighlightingTokenType.LITERAL_INTEGER:
                case HighlightingTokenType.LITERAL_FLOAT:
                case HighlightingTokenType.LITERAL_HEX:
                case HighlightingTokenType.LITERAL_BOOLEAN:
                case HighlightingTokenType.LITERAL_BINARY:
                    token.scopes = 'literal';
                    break;
                case HighlightingTokenType.LITERAL_STRING:
                    token.scopes = 'string';
                    break;
                case HighlightingTokenType.COMMENT:
                    token.scopes = 'comment';
                    break;
                case HighlightingTokenType.OPERATOR:
                    token.scopes = 'keyword.operator';
                    break;
                case HighlightingTokenType.DSON_KEY:
                    token.scopes = 'dson.key';
                    break;
                case HighlightingTokenType.IDENTIFIER:
                    token.scopes = '';
                    break;
                case HighlightingTokenType.NONE:
                    token.scopes = '';
                    break;
                // XXX
            }
            result.tokens.push(token);
        }
        return result;
    }
}