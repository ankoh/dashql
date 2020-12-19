import * as core from '../../src/index_node';

enum TestOpType { POP, DEC }
interface TestOp {
    type: TestOpType;
    key: number;
    by: number;
}

function PUSH(key: number, rank: number): [number, number] { return [key, rank]; }
function POP(key: number) { return { type: TestOpType.POP, key: key, by: 0 }; }
function DEC(key: number, by: number = 1) { return { type: TestOpType.DEC, key: key, by: by }; }

const tests: [string, [number, number][], TestOp[]][] = [
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
        (_name, input, ops) => {
            input.sort((l, r) => l[1] - r[1]);
            const heap = new core.utils.TopologicalSort(input);
            for (const op of ops) {
                if (op.type == TestOpType.DEC) {
                    heap.decrementKey(op.key, op.by);
                } else {
                    expect(heap.empty()).toBe(false);
                    expect(heap.top()).toBe(op.key);
                    heap.pop();
                }
            }
        }
    );
})
