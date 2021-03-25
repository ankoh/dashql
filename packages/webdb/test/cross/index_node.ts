import * as webdb from '../../src/targets/webdb-node-serial';
import path from 'path';

let db: webdb.WebDB | null = null;

beforeAll(async () => {
    const logger = new webdb.ConsoleLogger();
    const wasm = path.resolve(__dirname, './webdb.wasm');
    db = new webdb.WebDB(logger, webdb.DefaultWebDBRuntime, wasm);
    await db.open();
});

afterAll(() => {});

import { testProxies } from './proxy.test';
import { testBindings } from './bindings.test';
import { testIterator } from './iterator.test';

testProxies(() => db!);
testBindings(() => db!);
testIterator(() => db!);
