import * as core from '../../';

enum TestOpType { POP, DEC, INC, SET }
interface TestOp {
    type: TestOpType;
    key: number;
    value: number;
}

function PUSH(key: number, rank: number): [number, number] { return [key, rank]; }
function POP(key: number) { return { type: TestOpType.POP, key: key, value: 0 }; }
function DEC(key: number, by: number = 1) { return { type: TestOpType.DEC, key: key, value: by }; }
function INC(key: number, by: number = 1) { return { type: TestOpType.INC, key: key, value: by }; }
function SET(key: number, rank: number = 1) { return { type: TestOpType.SET, key: key, value: rank }; }

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

describe('NativeMinHeap', () => {
    test.each(tests)(
        "ops_%s",
        (_name, input, ops) => {
            input.sort((l, r) => l[1] - r[1]);
            const heap = new core.utils.NativeMinHeap(input);
            for (const op of ops) {
                switch (op.type) {
                    case TestOpType.DEC:
                        heap.decrementRank(op.key, op.value);
                        break;
                    case TestOpType.INC:
                        heap.incrementRank(op.key, op.value);
                        break;
                    case TestOpType.SET:
                        heap.setRank(op.key, op.value);
                        break;
                    default:
                        expect(heap.empty()).toBe(false);
                        expect(heap.top()).toBe(op.key);
                        heap.pop();
                        break;
                }
            }
        }
    );
})
