import { DashQLCore } from '../';

var core: DashQLCore;

beforeAll(async () => {
    core = new DashQLCore();
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
