import { CoreController } from './core';
import * as proto from '@tigon/proto';

const core = new CoreController();

beforeAll(async () => {
    await core.init();
});

let test_tql_parser_id = 0;

// Test a tql program
function test_tql_parser(text: string, expected: any) {
    test('test_' + test_tql_parser_id++, async () => {
        let session = await core.createSession();
        let program = await core.parseTQL(session, text);
        expect(program.toObject()).toEqual(expected);
        await core.endSession(session);
    });
}

describe('tql parsing', () => {
    test_tql_parser('', {
        statementsList: [],
    });

    test_tql_parser(`query foo as SELECT 1;`, {
        statementsList: [{ query: { queryId: 'foo', queryText: 'SELECT 1' } }],
    });

    test_tql_parser(
        `
        query "foo" as SELECT 1;
        query "bar" as SELECT 1 + 2;`,
        {
            statementsList: [
                { query: { queryId: 'foo', queryText: 'SELECT 1' } },
                { query: { queryId: 'bar', queryText: 'SELECT 1 + 2' } },
            ],
        },
    );

    test_tql_parser(
        `
        VIZ temp_weekly_table FROM temp_weekly USING TABLE (
            title = "Weekly Temperature Data",
            area = 6/20/4/2
        );
    `,
        {
            statementsList: [
                {
                    viz: {
                        queryId: 'temp_weekly',
                        vizId: 'temp_weekly_table',
                        vizType: proto.tql.VizType.VIZ_TABLE,
                        title: 'Weekly Temperature Data',
                        area: {
                            wildcard: {
                                width: {
                                    value: 6,
                                },
                                height: {
                                    value: 20,
                                },
                                offsetx: {
                                    value: 4,
                                },
                                offsety: {
                                    value: 2,
                                },
                            },
                        },
                    },
                },
            ],
        },
    );
});

describe('query execution', () => {
    test('SELECT 1;', async () => {
        let session = await core.createSession();
        await core.runQuery(session, 'SELECT 1;');
        await core.endSession(session);
    });
});
