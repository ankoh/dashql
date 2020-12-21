import { DashQLCoreWasm, CORE_WASM_RUNTIME_STUBS, model } from '../src/index_node';
import * as path from 'path';
import * as proto from '@dashql/proto';
import { PlatformMock } from './mocks';

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm(CORE_WASM_RUNTIME_STUBS, path.resolve(__dirname, "../src/wasm/core_wasm_node.wasm"));
    await core.init();
});

describe('Action Scheduler', () => {
   describe('setup actions', () => {
   });

   describe('program actions', () => {

        test('hello world', async () => {
            const platformMock = new PlatformMock();
            const platform = platformMock.getInstance();

        });
   });
});
