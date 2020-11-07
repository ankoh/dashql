import * as dashql_parser from '../';

var parser: dashql_parser.DashQLParser;

beforeAll(async () => {
    parser = await dashql_parser.DashQLParser.create();
});

describe('Parser', () => {
   describe('errors', () => {
       test('syntax error', async () => {
           const result = await parser.parse("?");
           const module = result.root;
           expect(result.root.statementsLength()).toEqual(0);
           expect(result.root.errorsLength()).toEqual(1);
       });
   });

   describe('single statements', () => {
       test('select 1', async () => {
           const result = await parser.parse(`
               select 1;
           `);
           const module = result.root;
           expect(module.errorsLength()).toEqual(0);
           expect(module.statementsLength()).toEqual(1);
       });
   });
});
