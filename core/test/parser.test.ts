import { analyzer } from '../';
import * as path from 'path';

var analyzerBindings: analyzer.AnalyzerBindings;

beforeAll(async () => {
    analyzerBindings = new analyzer.Analyzer({}, path.resolve(__dirname, '../src/analyzer/analyzer_wasm_node.wasm'));
    await analyzerBindings.init();
});

beforeEach(async () => {
    analyzerBindings.reset();
});

describe('Parser', () => {
   describe('errors', () => {
       test('syntax error', async () => {
           const r = analyzerBindings.parseProgram("?");
           const p = r.buffer;
           expect(p.statementsLength()).toEqual(0);
           expect(p.errorsLength()).toEqual(1);
       });
   });

   describe('single statements', () => {
       test('select 1', async () => {
           const r = analyzerBindings.parseProgram(`
               select 1;
           `);
           const p = r.buffer;
           expect(p.errorsLength()).toEqual(0);
           expect(p.statementsLength()).toEqual(1);
       });

       test('load http from url', async () => {
           const r = analyzerBindings.parseProgram(`
                LOAD weather_csv FROM http (
                    url = 'https://localhost/test'
                );
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
