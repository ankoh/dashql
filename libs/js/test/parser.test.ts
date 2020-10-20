import * as dashql_parser from '../';

var parser: dashql_parser.DashQLParser;

beforeAll(async () => {
    parser = new dashql_parser.DashQLParser();
    await parser.init();
});

describe('Parser', () => {

    test('simple integer parameter', async () => {
        let result = await parser.parse(`
            declare parameter days type integer;
        `)
        expect(result.root.errorsLength()).toBe(0);
    });
});

