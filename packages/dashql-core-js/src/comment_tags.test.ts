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

function parseMetadata(text: string): dashql.ScriptMetadata | null {
    return withParsed(text, (parsed, bytes) => dashql.readMetadata(parsed, bytes));
}

describe('Comment tags', () => {
    it('exposes every tag without interpreting it', () => {
        const text = [
            '-- @description Sales',
            '-- per région',
            '/* @metadata {"title": "x"} */',
            '',
            '-- plain comment',
            'select 1;',
        ].join('\n');
        const tags = withParsed(text, (parsed, bytes) => dashql.readCommentTags(parsed, bytes));
        expect(tags.map(tag => [tag.name, tag.text])).toEqual([
            ['description', 'Sales\nper région'],
            ['metadata', '{"title": "x"}'],
        ]);
        // The spans are byte offsets of the whole block
        const bytes = encoder.encode(text);
        const first = new TextDecoder().decode(bytes.subarray(tags[0].offset, tags[0].offset + tags[0].length));
        expect(first).toEqual('-- @description Sales\n-- per région');
        expect(dashql.parseCommentTagObject(tags[1])).toEqual({ title: 'x' });
        expect(dashql.parseCommentTagObject(tags[0])).toBeNull();
    });

    it('reads the tags of the description of a statement', () => {
        const text = annotate('select 1;\n\nselect 2;', 1, { preamble: [], tags: [dashql.annotationTag('description', 'Second\nstatement')] });
        expect(text).toEqual('select 1;\n\n/**\n * @description\n * Second\n * statement\n */\nselect 2;');
        const tags = withParsed(text, (parsed, bytes) => [0, 1].map(id => dashql.readStatementCommentTags(parsed, bytes, id)));
        expect(tags[0]).toEqual([]);
        expect(tags[1].map(tag => [tag.name, tag.text])).toEqual([['description', 'Second\nstatement']]);
    });

    it('checks that tag contents are JSON objects', () => {
        const tag = (text: string): dashql.CommentTag => ({ blockId: 0, name: 'x', text, offset: 0, length: 0 });
        expect(dashql.parseCommentTagObject(tag('{"a": [1]}'))).toEqual({ a: [1] });
        expect(dashql.parseCommentTagObject(tag('[1, 2]'))).toBeNull();
        expect(dashql.parseCommentTagObject(tag('null'))).toBeNull();
        expect(dashql.parseCommentTagObject(tag('owner: finance'))).toBeNull();
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

describe('Comment metadata', () => {
    it('writes pretty-printed JSON', () => {
        expect(annotate('select 1;', 0, { preamble: [], tags: [dashql.metadataTag({ owner: 'finance', runtime_ms: 1834 })] })).toEqual(
            [
                '/**',
                ' * @metadata',
                ' * {',
                ' *   "owner": "finance",',
                ' *   "runtime_ms": 1834',
                ' * }',
                ' */',
                'select 1;',
            ].join('\n'),
        );
        expect(dashql.metadataTag({ a: '*/ /*' }).lines).toContain('  "a": "*\\/ /\\u002a"');
    });
    it('round-trips through the parser', () => {
        const metadata = {
            owner: 'finance',
            notes: 'first line\nsecond line\r\n\tindented',
            quotes: 'say "hi" */ /* -- not a comment',
            tag: '@end',
            '@end': -1,
            unicode: 'Grüße 👋  ',
            empty: '',
            padded: '  spaces  ',
            nested: { list: [1, 'two', null, { three: true }], negative: -0.5 },
            flag: false,
            nothing: null,
        };
        for (const eol of ['\n', '\r\n']) {
            const text = annotate(`select 1;${eol}`, 0, { preamble: [], tags: [dashql.metadataTag(metadata)] });
            expect(parseMetadata(text)).toEqual(metadata);
        }
    });

    it('reads hand-written block comments', () => {
        const text = '/* @metadata\n * {"owner": "finance",\n *  "tags": ["weekly"]}\n */\nselect 1;\n';
        expect(parseMetadata(text)).toEqual({ owner: 'finance', tags: ['weekly'] });
    });

    it('ignores scripts without valid metadata', () => {
        expect(parseMetadata('select 1;')).toBeNull();
        expect(parseMetadata('-- @metadata\n-- owner: finance\nselect 1;')).toBeNull();
        expect(parseMetadata('-- @metadata\n-- [1, 2]\n-- @end\nselect 1;')).toBeNull();
    });

    it('keeps metadata next to a description', () => {
        const text = annotate('/**\n * @description\n * Revenue per segment.\n */\nselect 1;', 0, {
            preamble: [],
            tags: [dashql.metadataTag({ owner: 'finance' }), dashql.annotationTag('description', 'Revenue per segment.')],
        });
        expect(parseMetadata(text)).toEqual({ owner: 'finance' });
    });
});
