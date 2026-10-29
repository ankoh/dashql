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

function parseMetadata(text: string): dashql.ScriptMetadata | null {
    return withParsed(text, (parsed, bytes) => dashql.readMetadata(parsed, bytes));
}

describe('Comment tags', () => {
    it('exposes every tag without interpreting it', () => {
        const text = [
            '-- @description Sales',
            '-- per région',
            '-- @end',
            '/* @metadata {"title": "x"} */',
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
        expect(first).toEqual('-- @description Sales\n-- per région\n-- @end');
        expect(dashql.parseCommentTagObject(tags[1])).toEqual({ title: 'x' });
        expect(dashql.parseCommentTagObject(tags[0])).toBeNull();
    });

    it('reads the tags of the description of a statement', () => {
        const text = [
            'select 1;',
            '',
            dashql.renderCommentTag('description', 'Second\nstatement'),
            'select 2;',
        ].join('\n');
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

describe('Comment metadata', () => {
    it('renders pretty-printed JSON as line comments', () => {
        expect(dashql.renderMetadataBlock({ owner: 'finance', runtime_ms: 1834 })).toEqual(
            [
                '-- @metadata',
                '-- {',
                '--   "owner": "finance",',
                '--   "runtime_ms": 1834',
                '-- }',
                '-- @end',
            ].join('\n'),
        );
        expect(dashql.renderMetadataBlock({}, '\r\n')).toEqual('-- @metadata\r\n-- {}\r\n-- @end');
    });

    it('round-trips through the parser', () => {
        const metadata = {
            owner: 'finance',
            notes: 'first line\nsecond line\r\n\tindented',
            quotes: 'say "hi" */ -- not a comment',
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
            const text = `${dashql.renderMetadataBlock(metadata, eol)}${eol}${eol}select 1;${eol}`;
            expect(parseMetadata(text)).toEqual(metadata);
        }
    });

    it('reads hand-written block comments', () => {
        const text = '/* @metadata\n * {"owner": "finance",\n *  "tags": ["weekly"]}\n */\nselect 1;\n';
        expect(parseMetadata(text)).toEqual({ owner: 'finance', tags: ['weekly'] });
    });

    it('ignores scripts without valid metadata', () => {
        expect(parseMetadata('select 1;')).toBeNull();
        expect(parseMetadata('-- @metadata\n-- owner: finance\n-- @end\nselect 1;')).toBeNull();
        expect(parseMetadata('-- @metadata\n-- [1, 2]\n-- @end\nselect 1;')).toBeNull();
    });

    it('keeps metadata next to a description', () => {
        const text = [
            dashql.renderMetadataBlock({ owner: 'finance' }),
            '',
            '-- @description',
            '-- Revenue per segment.',
            '-- @end',
            'select 1;',
        ].join('\n');
        expect(parseMetadata(text)).toEqual({ owner: 'finance' });
    });
});
