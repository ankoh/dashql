import * as analyzer from '../src/analyzer';

export function testParser(az: () => analyzer.AnalyzerBindings): void {
    beforeEach(async () => {
        az().reset();
    });

    describe('Parser', () => {
        describe('errors', () => {
            it('syntax error', async () => {
                const r = az().parseProgram('?');
                const p = r.buffer;
                expect(p.statementsLength()).toEqual(0);
                expect(p.errorsLength()).toEqual(1);
            });
        });

        describe('single statements', () => {
            it('select 1', async () => {
                const r = az().parseProgram(`
                select 1;
            `);
                const p = r.buffer;
                expect(p.errorsLength()).toEqual(0);
                expect(p.statementsLength()).toEqual(1);
            });

            it('fetch http from url', async () => {
                const r = az().parseProgram(`
                    FETCH weather_csv FROM http (
                        url = 'https://localhost/test'
                    );
            `);
                const p = r.buffer;
                expect(p.errorsLength()).toEqual(0);
                expect(p.statementsLength()).toEqual(1);
            });
        });

        // describe('node inspection', () => {
        //     it('multiple statements', () => {
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
}
