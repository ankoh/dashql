import * as dashql from './index.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await dashql.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

describe('DashQL formatting', () => {
    it('instantiates WebAssembly module', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 +b from foo`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            4,
        );
        script.scan();
        script.parse();
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1 + b\n" +
            "from foo;"
        );
    });

    it('formats with a null catalog', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 +b from foo`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            4,
        );
        script.scan();
        script.parse();
        const newScript = script.format(config, null);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1 + b\n" +
            "from foo;"
        );
    });

    it('formats outdated scripts by parsing on demand', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 +b from foo`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            4,
        );
        const newScript = script.format(config, null, true);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1 + b\n" +
            "from foo;"
        );
    });

    it('formats with debug settings preamble and line width comments', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 +b from foo`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            4,
            true,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "/* indentation=4, max_width=20 */\n" +
            "select 1 + b /*12*/\n" +
            "from foo;"
        );
    });

    it('breaks compact select target lists at max width', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select long, list, of, multiple, columns, exceeding, 42, without, line, break`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            42,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select long, list, of, multiple, columns,\n" +
            "  exceeding, 42, without, line, break;"
        );
    });

    it('breaks compact qualified names with leading dots', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1 from memory.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccccccccccccccccccccccccccccccccccccccc`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1\n" +
            "from memory\n" +
            "  .bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n" +
            "  .cccccccccccccccccccccccccccccccccccccccccccccccccccccccccc;"
        );
    });

    it('breaks compact expression chains at runtime', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select 1111111111+2222222222+3333333333`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            20,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1111111111 +\n" +
            "    2222222222 +\n" +
            "  3333333333;"
        );
    });

    it('formats order by direction and nulls rule', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select a, b from t order by a desc nulls last, b`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            80,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select a, b from t order by a desc nulls last, b;"
        );
    });

    it('formats constant interval casts', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select interval '30 days'`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            80,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select interval '30 days';"
        );
    });

    it('formats typed constant interval casts', async () => {
        const catalog = dql!.createCatalog();
        const script = dql!.createScript(catalog);
        script.insertTextAt(0, `select interval '90' day`);
        const config = new dashql.buffers.formatting.FormattingConfigT(
            dashql.buffers.formatting.FormattingDialect.DUCKDB,
            dashql.buffers.formatting.FormattingMode.COMPACT,
            80,
            2,
        );
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select interval '90' day;"
        );
    });
});
