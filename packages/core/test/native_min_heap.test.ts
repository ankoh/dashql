import * as utils from '../src/utils';

enum TestOpType {
    POP_OP,
    DEC_OP,
    INC_OP,
    SET_OP,
}
interface TestOp {
    type: TestOpType;
    key: number;
    value: number;
}

function PUSH(key: number, rank: number): [number, number] {
    return [key, rank];
}
function POP(key: number) {
    return { type: TestOpType.POP_OP, key: key, value: 0 };
}
function DEC(key: number, by = 1) {
    return { type: TestOpType.DEC_OP, key: key, value: by };
}
//function INC(key: number, by: number = 1) {
//    return { type: TestOpType.INC, key: key, value: by };
//}
//function SET(key: number, rank: number = 1) {
//    return { type: TestOpType.SET, key: key, value: rank };
//}

const tests: [string, [number, number][], TestOp[]][] = [
    ['simple_1', [PUSH(0, 0)], [POP(0)]],
    ['simple_2', [PUSH(0, 2), PUSH(1, 1)], [POP(1), POP(0)]],
    [
        'simple_3',
        [PUSH(0, 0), PUSH(1, 2), PUSH(2, 1), PUSH(3, 1)],
        [POP(0), DEC(1), DEC(2), POP(2), DEC(1), POP(1), DEC(3), POP(3)],
    ],
];

export function testNativeMinHeap(): void {
    describe('NativeMinHeap', () => {
        tests.forEach(element => {
            const name = element[0];
            const input = element[1];
            const ops = element[2];
            it(name, () => {
                input.sort((l: [number, number], r: [number, number]) => l[1] - r[1]);
                const heap = new utils.NativeMinHeap(input);
                for (const op of ops) {
                    switch (op.type) {
                        case TestOpType.DEC_OP:
                            heap.decrementRank(op.key, op.value);
                            break;
                        case TestOpType.INC_OP:
                            heap.incrementRank(op.key, op.value);
                            break;
                        case TestOpType.SET_OP:
                            heap.setRank(op.key, op.value);
                            break;
                        default:
                            expect(heap.empty()).toBe(false);
                            expect(heap.top()).toBe(op.key);
                            heap.pop();
                            break;
                    }
                }
            });
        });
    });
}
