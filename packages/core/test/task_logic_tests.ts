import * as proto from '@dashql/proto';
import * as arrow from 'apache-arrow';
import { CardDataResolver, CardRendererType, InputValue, StatementStatus, UniqueBlob } from '../src/model';
import { encodeTextBody } from './http_mock';

const COMPLETED = proto.task.TaskStatusCode.COMPLETED;

interface DatabaseTest {
    script: string;
    expected: arrow.Table;
}

interface StepSpec {
    text: string;
    input?: InputValue[];
    expected: {
        status: StatementStatus[];
        blobs?: UniqueBlob[];
        cards?: (any & { objectId: number })[];
        data?: DatabaseTest[];
    };
}

interface HTTPRequestMock {
    url: string;
    status: number;
    data: ArrayBuffer;
}

interface SchedulerSpec {
    name: string;
    steps: StepSpec[];
    mocks: {
        http: HTTPRequestMock[];
    };
}

export const TEST_CASES: SchedulerSpec[] = [
    {
        name: 'Generate Series',
        steps: [
            {
                text: `
                    CREATE TABLE foo AS (
                        SELECT * FROM generate_series(1, 100) t(v)
                    );
                    VIZ foo USING TABLE;
                `,
                expected: {
                    status: [
                        { status: COMPLETED, totalTasks: 1, totalPerStatus: [] },
                        { status: COMPLETED, totalTasks: 1, totalPerStatus: [] },
                    ],
                    data: [
                        {
                            script: 'SELECT * FROM foo LIMIT 10',
                            expected: arrow.Table.new(
                                [arrow.Int32Vector.from(Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))],
                                ['v'],
                            ),
                        },
                    ],
                    cards: [
                        {
                            objectId: 1, // origin == tasks[1]
                            cardRenderer: CardRendererType.BUILTIN_TABLE,
                            dataSource: {
                                dataResolver: CardDataResolver.PIECEWISE_SCAN,
                                targetQualified: 'main.foo',
                            },
                        },
                    ],
                },
            },
        ],
        mocks: {
            http: [],
        },
    },
    {
        name: 'Mocked HTTP Fetch',
        steps: [
            {
                text: `
                    FETCH test_csv FROM 'http://localhost/someurl.csv';
                    LOAD test FROM test_csv USING CSV;
                    VIZ test USING TABLE;
                `,
                expected: {
                    status: [
                        { status: COMPLETED, totalTasks: 1, totalPerStatus: [] },
                        { status: COMPLETED, totalTasks: 1, totalPerStatus: [] },
                        { status: COMPLETED, totalTasks: 1, totalPerStatus: [] },
                    ],
                    data: [
                        {
                            script: 'SELECT * FROM test LIMIT 10',
                            expected: arrow.Table.new(
                                [
                                    arrow.Int32Vector.from(Int32Array.from([1, 2, 3, 4])),
                                    arrow.Int32Vector.from(Int32Array.from([5, 6, 7, 8])),
                                ],
                                ['a', 'b'],
                            ),
                        },
                    ],
                    cards: [
                        {
                            objectId: 2, // origin == tasks[2]
                            cardRenderer: CardRendererType.BUILTIN_TABLE,
                            dataSource: {
                                dataResolver: CardDataResolver.PIECEWISE_SCAN,
                                targetQualified: 'main.test',
                            },
                        },
                    ],
                },
            },
        ],
        mocks: {
            http: [
                {
                    url: 'http://localhost/someurl.csv',
                    status: 200,
                    data: encodeTextBody(`a,b\n1,5\n2,6\n3,7\n4,8\n`),
                },
            ],
        },
    },
];
