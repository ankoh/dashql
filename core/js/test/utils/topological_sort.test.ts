import * as core from '../../';

enum TestOpType { POP, DEC }
interface TestOp {
    type: TestOpType;
    key: number;
    by: number;
}
interface TestInput {
    key: number;
    rank: number;
}

function PUSH(key: number, rank: number) { return { key: key, rank: rank }; }
function POP(key: number) { return { type: TestOpType.POP, key: key, by: 0 }; }
function DEC(key: number, by: number = 1) { return { type: TestOpType.DEC, key: key, by: by }; }

const tests: [string, TestInput[], TestOp[]][] = [
    [
        "simple_1",
        [ PUSH(0, 0) ],
        [ POP(0) ]
    ],
    [ 
        "simple_2",
        [ PUSH(0, 2), PUSH(1, 1) ],
        [ POP(1), POP(0) ]
    ],
    [ 
        "simple_3",
        [ PUSH(0, 0), PUSH(1,2), PUSH(2, 1), PUSH(3, 1) ],
        [ POP(0), DEC(1), DEC(2), POP(2), POP(1), POP(3) ]
    ],
];

describe('TopologicalSort', () => {
    test.each(tests)(
        "%s",
        (_name, _input, _ops) => {
            const _heap = new core.utils.TopologicalSort(42);
        }
    );
})
