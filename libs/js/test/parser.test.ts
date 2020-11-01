import * as dashql_parser from '../';

var parser: dashql_parser.DashQLParser;

beforeAll(async () => {
    parser = await dashql_parser.DashQLParser.create();
});

describe('Parser', () => {
    describe('foo', () => {
        test('synatx error', () => {
            const result = parser.parse("select 1e-04");
            expect(result.root.errorsLength()).toBe(0);
            expect(result.root.statements()!.entriesLength()).toBe(1);
        });
    });
//    describe('errors', () => {
//        test('synatx error', async () => {
//            let result = await parser.parse("?");
//            expect(result.root.errorsLength()).toBe(1);
//            expect(result.root.statementsLength()).toBe(0);
//        });
//
//        test('error recovery', async () => {
//            let result = await parser.parse(`
//                ?select * from foo;
//            `);
//            let program = result.root;
//            expect(program.errorsLength()).toBe(1);
//            expect(program.statementsLength()).toBe(1);
//        });
//    });
//
//    describe('single statements', () => {
//        test('integer parameter', async () => {
//            let result = await parser.parse(`
//                declare parameter days type integer;
//            `);
//            let program = result.root;
//            expect(program.errorsLength()).toBe(0);
//            expect(program.statementsLength()).toBe(1);
//        });
//
//        test('http load', async () => {
//            let result = await parser.parse(`
//                load raw_data from http (
//                    url = 'http://www.google.com',
//                    method = get
//                );
//            `);
//            let program = result.root;
//            expect(program.errorsLength()).toBe(0);
//            expect(program.statementsLength()).toBe(1);
//        });
//
//        test('extract json', async () => {
//            let result = await parser.parse(`
//                extract weather_data from raw_data using json ();
//            `);
//            let program = result.root;
//            expect(program.errorsLength()).toBe(0);
//            expect(program.statementsLength()).toBe(1);
//        });
//
//        test('select 1', async () => {
//            let result = await parser.parse(`
//                select 1;
//            `);
//            let program = result.root;
//            expect(program.errorsLength()).toBe(0);
//            expect(program.statementsLength()).toBe(1);
//        });
//
//        test('query as select 1', async () => {
//            let result = await parser.parse(`
//                query "foo" as select 1;
//            `);
//            let program = result.root;
//            expect(program.errorsLength()).toBe(0);
//            expect(program.statementsLength()).toBe(1);
//        });
//    });
});

