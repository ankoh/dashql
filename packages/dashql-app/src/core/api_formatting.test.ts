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
            "from foo"
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
            "from foo"
        );
    });

    it('formats with debug line width comments', async () => {
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
        script.scan();
        script.parse();
        const newScript = script.format(config, catalog);
        const newScriptText = newScript.toString();
        expect(newScriptText).toEqual(
            "select 1 + b /*12*/\n" +
            "from foo"
        );
    });
});
