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

describe('DashQL setup', () => {
    it('instantiates WebAssembly module', async () => {
        expect(dql).not.toBeNull();
        expect(dql).not.toBeUndefined();
        const version = dql!.getVersionText();
        expect(version).not.toBeFalsy();
        expect(version).toMatch(/^[0-9]+.[0-9]+.[0-9]+(\-dev\.[0-9]+)?$/);
    });
});

describe('ContextObjectChildID', () => {
    it('create child ids', () => {
        const parentId = dashql.ExternalObjectID.create(1234, 5678);
        const childId = dashql.ContextObjectChildID.create(parentId, 91011);
        expect(childId).not.toEqual(parentId);
        expect(dashql.ContextObjectChildID.getParent(childId)).toEqual(parentId);
        expect(dashql.ContextObjectChildID.getChild(childId)).toEqual(91011);
        expect(childId.toString()).toEqual("22763282211344411091843");
    });
});
