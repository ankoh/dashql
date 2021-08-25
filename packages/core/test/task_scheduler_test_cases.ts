import { InputValue, StatementStatus, UniqueBlob } from '../src/model';

interface DatabaseTest {
    script: string;
    expected: string;
}

interface StepSpec {
    name: string;
    text: string;
    input: InputValue[];
    expected: {
        status: StatementStatus[];
        blobs: [number, UniqueBlob][];
        cards: [number, UniqueBlob][];
        data: DatabaseTest[];
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
                        SELECT v::INTEGER FROM generate_series(1, 100) t(v)
                    );
                `,
                input: [],
                expected: {
                    status: [],
                    blobs: [],
                    cards: [],
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
