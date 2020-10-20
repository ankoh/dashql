import * as dashql_parser from '../';

var parser: dashql_parser.DashQLParser;

beforeAll(async () => {
    parser = new dashql_parser.DashQLParser();
    await parser.init();
});

beforeEach(async () => {
});

afterEach(async () => {
});

describe('Parser', () => {
    test('DUMMY', async () => {
        expect(1).toBe(1);
    });
});

