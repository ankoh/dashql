import * as dashql_parser from '../';

var core: dashql_parser.DashQLCore;

beforeAll(async () => {
    core = await dashql_parser.DashQLCore.create();
});

describe('Parser', () => {
   describe('errors', () => {
       test('syntax error', async () => {
           const result = await core.parse("?");
           const module = result.root;
           expect(result.root.statementsLength()).toEqual(0);
           expect(result.root.errorsLength()).toEqual(1);
       });
   });

   describe('single statements', () => {
       test('select 1', async () => {
           const result = await core.parse(`
               select 1;
           `);
           const module = result.root;
           expect(module.errorsLength()).toEqual(0);
           expect(module.statementsLength()).toEqual(1);
       });
   });
});
