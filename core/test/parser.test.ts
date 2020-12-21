import { DashQLCoreWasm, CORE_WASM_RUNTIME_STUBS } from '../src/index_node';
import * as path from 'path';

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm(CORE_WASM_RUNTIME_STUBS, path.resolve(__dirname, "../src/wasm/core_wasm_node.wasm"));
    await core.init();
});

describe('Parser', () => {
   describe('errors', () => {
       test('syntax error', async () => {
           const r = core.parseProgram("?");
           const p = r.buffer;
           expect(p.statementsLength()).toEqual(0);
           expect(p.errorsLength()).toEqual(1);
       });
   });

   describe('single statements', () => {
       test('select 1', async () => {
           const r = core.parseProgram(`
               select 1;
           `);
           const p = r.buffer;
           expect(p.errorsLength()).toEqual(0);
           expect(p.statementsLength()).toEqual(1);
       });
   });


    // describe('node inspection', () => {
    //     test('multiple statements', () => {
    //         const m = core.parse(`
    //             declare parameter a type integer;
    //             select 1 into b;
    //             select c from b where c = global.a + 1
    //         `);
    //         expect(m.buffer.errorsLength()).toEqual(0);
    //         expect(m.buffer.statementsLength()).toEqual(3);

    //         const seq: [number, string][] = [];
    //         m.iterateStatements((stmt_id: number, stmt: parser.Statement) => {
    //             stmt.traversePreOrder((node_id: number, node: parser.Node) => {
    //                 seq.push([stmt_id, sx.NodeType[node.nodeType]]);
    //             });
    //         });
    //         expect(seq).toEqual([]);
    //     });
    // });
});
