import { splitStatements } from './statements.js';

function texts(sql: string): string[] {
    return splitStatements(sql).map(s => s.text);
}

describe('splitStatements', () => {
    it('keeps a single statement without a semicolon', () => {
        expect(splitStatements('select 1')).toEqual([{ text: 'select 1', line: 1 }]);
    });

    it('drops the terminating semicolon and the surrounding whitespace', () => {
        expect(splitStatements('  select 1 ;  \n')).toEqual([{ text: 'select 1', line: 1 }]);
    });

    it('splits at the semicolons between statements', () => {
        expect(texts('create table t(a int); insert into t values (1);select * from t')).toEqual([
            'create table t(a int)',
            'insert into t values (1)',
            'select * from t',
        ]);
    });

    it('leaves out empty statements', () => {
        expect(texts(';;select 1;;\n;select 2;')).toEqual(['select 1', 'select 2']);
        expect(texts('')).toEqual([]);
        expect(texts('  \n\t ')).toEqual([]);
    });

    it('leaves out statements of only comments', () => {
        expect(texts('-- nothing here\n/* nor here */;')).toEqual([]);
        expect(texts('select 1; -- trailing comment\n')).toEqual(['select 1']);
    });

    it('starts a statement after the comments before it', () => {
        expect(splitStatements('-- the answer\nselect 42;')).toEqual([{ text: 'select 42', line: 2 }]);
        expect(splitStatements('/* a\n b */ select 1')).toEqual([{ text: 'select 1', line: 2 }]);
    });

    it('counts the line of every statement in the whole text', () => {
        const statements = splitStatements('select 1;\n\nselect 2;\n  select\n  3;');
        expect(statements.map(s => s.line)).toEqual([1, 3, 4]);
    });

    it('counts lines inside literals and comments that come before a statement', () => {
        const statements = splitStatements("select 'a\nb';\n/*\n\n*/select 2");
        expect(statements).toEqual([
            { text: "select 'a\nb'", line: 1 },
            { text: 'select 2', line: 5 },
        ]);
    });

    it('ignores semicolons in string literals', () => {
        expect(texts("select 'a;b'; select 2")).toEqual(["select 'a;b'", 'select 2']);
    });

    it('reads doubled quotes as part of a string literal', () => {
        expect(texts("select 'it''s; fine'; select 2")).toEqual(["select 'it''s; fine'", 'select 2']);
    });

    it('reads backslash escapes only in escape strings', () => {
        expect(texts("select E'a\\';b'; select 2")).toEqual(["select E'a\\';b'", 'select 2']);
        expect(texts("select e'\\\\'; select 2")).toEqual(["select e'\\\\'", 'select 2']);
        // In a standard string a backslash is a plain character, the quote after it ends the literal
        expect(texts("select 'a\\'; select 2")).toEqual(["select 'a\\'", 'select 2']);
    });

    it('reads an E at the end of an identifier as part of the identifier', () => {
        // `some` + 'x' is not an escape string, so the backslash does not escape the quote
        expect(texts("select some'\\'; select 2")).toEqual(["select some'\\'", 'select 2']);
    });

    it('ignores semicolons in quoted identifiers', () => {
        expect(texts('select 1 as "a;b"; select 2')).toEqual(['select 1 as "a;b"', 'select 2']);
        expect(texts('select 1 as "a"";b"; select 2')).toEqual(['select 1 as "a"";b"', 'select 2']);
    });

    it('ignores semicolons in comments', () => {
        expect(texts('select 1 -- a; b\n; select 2')).toEqual(['select 1 -- a; b', 'select 2']);
        expect(texts('select /* a; b */ 1; select 2')).toEqual(['select /* a; b */ 1', 'select 2']);
    });

    it('reads nested block comments', () => {
        expect(texts('select /* a /* b; */ c; */ 1; select 2')).toEqual(['select /* a /* b; */ c; */ 1', 'select 2']);
    });

    it('ignores semicolons in dollar-quoted strings', () => {
        expect(texts('select $$a;b$$; select 2')).toEqual(['select $$a;b$$', 'select 2']);
        expect(texts('select $tag$a;$$;b$tag$; select 2')).toEqual(['select $tag$a;$$;b$tag$', 'select 2']);
    });

    it('does not read positional parameters or dollars in identifiers as dollar quotes', () => {
        expect(texts('select $1; select 2')).toEqual(['select $1', 'select 2']);
        expect(texts('select a$b$c; select 2')).toEqual(['select a$b$c', 'select 2']);
    });

    it('does not read a minus or a slash alone as a comment', () => {
        expect(texts('select 3 - 1; select 4 / 2')).toEqual(['select 3 - 1', 'select 4 / 2']);
    });

    it('runs an unterminated literal or comment to the end of the text', () => {
        expect(texts("select 'a; select 2")).toEqual(["select 'a; select 2"]);
        expect(texts('select "a; select 2')).toEqual(['select "a; select 2']);
        expect(texts('select /* a; select 2')).toEqual(['select /* a; select 2']);
        expect(texts('select $$a; select 2')).toEqual(['select $$a; select 2']);
    });

    it('keeps the text between the statements unchanged', () => {
        const sql = "select\n  'x' as a,\n  2 as b\nfrom t";
        expect(texts(`${sql};`)).toEqual([sql]);
    });

    it('reads CRLF line ends', () => {
        expect(splitStatements('select 1;\r\nselect 2;\r\n')).toEqual([
            { text: 'select 1', line: 1 },
            { text: 'select 2', line: 2 },
        ]);
    });
});
