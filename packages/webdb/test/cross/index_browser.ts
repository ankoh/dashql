import * as webdb from '../../src/targets/webdb-browser-serial';

let db: webdb.WebDB | null = null;

beforeAll(async () => {
    const logger = new webdb.ConsoleLogger();
    db = new webdb.WebDB(logger, webdb.DefaultWebDBRuntime, '/static/webdb.wasm');
    await db.open();
});

import { testProxies } from './proxy.test';
import { testBindings } from './bindings.test';
import { testIterator } from './iterator.test';

testProxies(() => db!);
testBindings(() => db!);
testIterator(() => db!);
