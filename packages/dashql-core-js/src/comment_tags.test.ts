import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await loadCoreWasm();
    dql = await dashql.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

const encoder = new TextEncoder();

function withParsed<T>(text: string, fn: (parsed: dashql.buffers.parser.ParsedScript, bytes: Uint8Array) => T): T {
    const catalog = dql!.createCatalog();
    const script = dql!.createScript(catalog);
    script.insertTextAt(0, text);
    script.parse();
    const parsed = script.getParsed();
    try {
        return fn(parsed.read(), encoder.encode(text));
    } finally {
        script.destroy();
        catalog.destroy();
    }
}

/// Replace the annotation of a statement of a text
function annotate(text: string, statementId: number, annotation: dashql.ScriptAnnotation): string {
    const catalog = dql!.createCatalog();
    const script = dql!.createScript(catalog);
    try {
        script.insertTextAt(0, text);
        return script.rewriteAnnotation(statementId, annotation);
    } finally {
        script.destroy();
        catalog.destroy();
    }
}

describe('Comment tags', () => {
    it('exposes every tag without interpreting it', () => {
        const text = [
            '-- @param Sales',
            '-- per région',
            '/* @board width=6 */',
            '',
            '-- plain comment',
            'select 1;',
        ].join('\n');
        const tags = withParsed(text, (parsed, bytes) => dashql.readCommentTags(parsed, bytes));
        expect(tags.map(tag => [tag.name, tag.text])).toEqual([
            ['param', 'Sales\nper région'],
            ['board', 'width=6'],
        ]);
        // The spans are byte offsets of the whole block
        const bytes = encoder.encode(text);
        const first = new TextDecoder().decode(bytes.subarray(tags[0].offset, tags[0].offset + tags[0].length));
        expect(first).toEqual('-- @param Sales\n-- per région');
    });

    it('reads the tags of the description of a statement', () => {
        const text = annotate('select 1;\n\nselect 2;', 1, { preamble: [], tags: [dashql.annotationTag('param', 'Second\nstatement')] });
        expect(text).toEqual('select 1;\n\n/**\n * @param\n * Second\n * statement\n */\nselect 2;');
        const tags = withParsed(text, (parsed, bytes) => [0, 1].map(id => dashql.readStatementCommentTags(parsed, bytes, id)));
        expect(tags[0]).toEqual([]);
        expect(tags[1].map(tag => [tag.name, tag.text])).toEqual([['param', 'Second\nstatement']]);
    });
});

describe('Annotations', () => {
    it('reads and rewrites the annotation of a statement', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        // The text before the first tag describes the statement
        script.insertTextAt(0, '/* Sales.\n   @param :min = 1\n   @vis table */\nselect 1;');
        const annotation = script.readAnnotation(0);
        expect(annotation).toEqual({
            preamble: ['Sales.'],
            tags: [{ name: 'param', lines: [':min = 1'] }, { name: 'vis', lines: ['table'] }],
        });
        expect(dashql.annotationTagText(annotation.tags[0])).toEqual(':min = 1');
        annotation.preamble = ['Revenue.'];
        annotation.tags[0] = dashql.annotationTag('param', ':min = 2');
        expect(script.rewriteAnnotation(0, annotation)).toEqual('/**\n * Revenue.\n *\n * @param\n * :min = 2\n * @vis table\n */\nselect 1;');
        expect(script.rewriteAnnotation(0, { preamble: [], tags: [] })).toEqual('select 1;');
        expect(() => script.rewriteAnnotation(0, { preamble: [], tags: [dashql.annotationTag('param', 'a */ b')] })).toThrow('cannot contain');
        expect(() => script.rewriteAnnotation(0, { preamble: [], tags: [{ name: 'todo', lines: [] }] })).toThrow('unknown comment tag');
        script.destroy();
        catalog.destroy();
    });
});
