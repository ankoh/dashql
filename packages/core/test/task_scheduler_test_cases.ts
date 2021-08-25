import * as proto from '@dashql/proto';
import { InputValue, StatementStatus, UniqueBlob } from '../src/model';

const COMPLETED = proto.task.TaskStatusCode.COMPLETED;

interface DatabaseTest {
    script: string;
    expected: string;
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

interface SchedulerSpec {
    name: string;
    steps: StepSpec[];
    mocks: {
        http: [string, Blob][];
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
                            script: 'SELECT * FROM foo',
                            expected: '',
                        },
                    ],
                },
            },
        ],
        mocks: {
            http: [],
        },
    },
];
