import * as proto from '@dashql/proto';
import * as arrow from 'apache-arrow';
import { InputValue, StatementStatus, UniqueBlob } from '../src/model';

const COMPLETED = proto.task.TaskStatusCode.COMPLETED;

interface DatabaseTest {
    script: string;
    expected: arrow.Table;
}

interface StepSpec {
    name: string;
    text: string;
    input?: InputValue[];
    expected: {
        status: StatementStatus[];
        blobs?: [number, UniqueBlob][];
        cards?: [number, any][];
        data?: DatabaseTest[];
    };
}

interface HTTPRequestMock {
    url: string;
    status: number;
    data: Blob;
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
                name: 'Create Table',
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
                    cards: [],
                },
            },
        ],
        mocks: {
            http: [],
        },
    },
];
