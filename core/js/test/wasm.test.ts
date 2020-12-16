import { DashQLCoreWasm } from '../';

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm();
    await core.init();
});

describe('Runtime', () => {
   describe('ping', () => {
       test('pong', async () => {
           const r = core.ping();
           expect(r).toEqual(42);
       });
   });
})
