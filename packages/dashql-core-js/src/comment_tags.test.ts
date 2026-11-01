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
            '-- @description Sales',
            '-- per région',
            '/* @board width=6 */',
            '',
            '-- plain comment',
            'select 1;',
        ].join('\n');
        const tags = withParsed(text, (parsed, bytes) => dashql.readCommentTags(parsed, bytes));
        expect(tags.map(tag => [tag.name, tag.text])).toEqual([
            ['description', 'Sales\nper région'],
            ['board', 'width=6'],
        ]);
        // The spans are byte offsets of the whole block
        const bytes = encoder.encode(text);
        const first = new TextDecoder().decode(bytes.subarray(tags[0].offset, tags[0].offset + tags[0].length));
        expect(first).toEqual('-- @description Sales\n-- per région');
    });

    it('reads the tags of the description of a statement', () => {
        const text = annotate('select 1;\n\nselect 2;', 1, { preamble: [], tags: [dashql.annotationTag('description', 'Second\nstatement')] });
        expect(text).toEqual('select 1;\n\n/**\n * @description\n * Second\n * statement\n */\nselect 2;');
        const tags = withParsed(text, (parsed, bytes) => [0, 1].map(id => dashql.readStatementCommentTags(parsed, bytes, id)));
        expect(tags[0]).toEqual([]);
        expect(tags[1].map(tag => [tag.name, tag.text])).toEqual([['description', 'Second\nstatement']]);
    });
});

describe('Annotations', () => {
    it('reads and rewrites the annotation of a statement', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, '-- @description\n-- Sales.\n-- @end\n\n/* @vis table */\nselect 1;');
        const annotation = script.readAnnotation(0);
        expect(annotation).toEqual({
            preamble: [],
            tags: [{ name: 'description', lines: ['', 'Sales.'] }, { name: 'vis', lines: ['table'] }],
        });
        expect(dashql.annotationTagText(annotation.tags[0])).toEqual('Sales.');
        annotation.tags[0] = dashql.annotationTag('description', 'Revenue.');
        expect(script.rewriteAnnotation(0, annotation)).toEqual('/**\n * @description\n * Revenue.\n * @vis table\n */\nselect 1;');
        expect(script.rewriteAnnotation(0, { preamble: [], tags: [] })).toEqual('select 1;');
        expect(() => script.rewriteAnnotation(0, { preamble: [], tags: [dashql.annotationTag('description', 'a */ b')] })).toThrow('cannot contain');
        expect(() => script.rewriteAnnotation(0, { preamble: [], tags: [{ name: 'todo', lines: [] }] })).toThrow('unknown comment tag');
        script.destroy();
        catalog.destroy();
    });
});
