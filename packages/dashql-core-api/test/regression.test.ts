import '@jest/globals';

import * as dashql from '../src/index.js';

declare const DASHQL_PRECOMPILED: (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create(DASHQL_PRECOMPILED);
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

describe('Regression Tests ', () => {
    it('dynamic registration, one table', () => {
        const catalog = dql!.createCatalog();
        {
            const script = dql!.createScript(catalog, 2);
            script.replaceText('select 1');
            script.scan();
            script.parse();
        }
        {
            const script = dql!.createScript(catalog, 3);
            script.replaceText('select 1');
            script.scan();
            script.parse();
        }
    });
});
