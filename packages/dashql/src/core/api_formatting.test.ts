import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

// The layouts of the formatter are tested by the snapshots of the core (tests/snapshots/formatter), these tests check
// that the bindings pass the script, the catalog and the settings through

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await loadCoreWasm();
    dql = await dashql.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

const formatting = dashql.buffers.formatting;

/// The settings of a formatting in the Hyper dialect
function config(mode: dashql.buffers.formatting.FormattingMode, maxWidth: number, options: { debug?: boolean; keywordCase?: dashql.buffers.formatting.KeywordCase } = {}) {
    return new formatting.FormattingConfigT(
        formatting.FormattingDialect.HYPER,
        mode,
        maxWidth,
        2,
        options.debug ?? false,
        options.keywordCase ?? formatting.KeywordCase.LOWER,
    );
}

describe('DashQL formatting', () => {
    it('formats a parsed script with the catalog, without and by parsing on demand', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 +b from foo`);
        // The max width of the settings breaks the statement
        const narrow = config(formatting.FormattingMode.COMPACT, 20);
        const expected = 'select 1 + b\nfrom foo;';

        expect(script.format(narrow, null, true).toString()).toEqual(expected);
        expect(script.isFullyFormattable(narrow)).toBe(true);
        script.parse();
        expect(script.format(narrow, catalog).toString()).toEqual(expected);
        expect(script.format(narrow, null).toString()).toEqual(expected);
        expect(script.format(config(formatting.FormattingMode.COMPACT, 80), catalog).toString()).toEqual('select 1 + b from foo;');
    });

    it('formats an analyzed script in every mode', () => {
        const catalog = dql!.createCatalog();
        const schema = dql!.createScript(catalog);
        schema.insertTextAt(0, 'create table part (p_partkey integer, p_name varchar(55))');
        schema.analyze();
        catalog.loadScript(schema, dashql.buffers.catalog.CatalogLayer.SESSION);

        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select * from part`);
        script.analyze();
        for (const mode of [formatting.FormattingMode.INLINE, formatting.FormattingMode.COMPACT, formatting.FormattingMode.PRETTY]) {
            const text = script.format(config(mode, 120), catalog, true).toString();
            expect(text).toContain('select');
            expect(text).toContain('from part');
        }
    });

    it('uppercases generated keywords without changing source names or strings', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select "MixedName", 'from where' from "CaseTable" where "MixedName" is not null`);
        const formatted = script.format(config(formatting.FormattingMode.COMPACT, 120, { keywordCase: formatting.KeywordCase.UPPER }));
        try {
            expect(formatted.toString()).toBe(`SELECT "MixedName", 'from where' FROM "CaseTable" WHERE "MixedName" IS NOT NULL;`);
        } finally {
            formatted.destroy();
            script.destroy();
            catalog.destroy();
        }
    });

    it('formats with debug settings preamble and line width comments', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 +b from foo`);
        const text = script.format(config(formatting.FormattingMode.COMPACT, 20, { debug: true }), catalog).toString();
        expect(text).toMatch(/^\/\* indentation=2, max_width=20 \*\/\n/);
        // A broken line tells its width
        expect(text).toMatch(/\/\*\d+\*\/\n/);
    });

    it('formats bit types without placeholders', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, "select cast('1' as bit varying(3))");
        const settings = config(formatting.FormattingMode.COMPACT, 80);

        expect(script.isFullyFormattable(settings)).toBe(true);
        expect(script.format(settings, null, true).toString()).toEqual("select cast('1' as bit varying(3));");
    });

    it('reports statements with syntax errors as incomplete formatting', () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, "select 1; selec   2");
        expect(script.isFullyFormattable(config(formatting.FormattingMode.COMPACT, 80))).toBe(false);
    });
});
