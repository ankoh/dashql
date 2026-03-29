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

describe('Regression Tests ', () => {
    it('dynamic registration, one table', () => {
        const catalog = dql!.createCatalog();
        {
            const script = dql!.createScript(catalog);
            script.replaceText('select 1');
            script.scan();
            script.parse();
        }
        {
            const script = dql!.createScript(catalog);
            script.replaceText('select 1');
            script.scan();
            script.parse();
        }
    });
});
