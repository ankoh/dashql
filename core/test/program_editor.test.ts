import { analyzer, edit  } from '../src/index_node';
import * as path from 'path';

var az: analyzer.AnalyzerBindings;

beforeAll(async () => {
    az = new analyzer.Analyzer({}, path.resolve(__dirname, '../src/analyzer/analyzer_wasm_node.wasm'));
    await az.init();
});

beforeEach(async () => {
    az.reset();
});

describe('Program editor', () => {
    test('rewrite viz position', async () => {
        const p = az.parseProgram("VIZ weather_avg USING LINE");
        const pi = az.instantiateProgram();
        expect(p.buffer.statementsLength()).toEqual(1);
        expect(pi).not.toEqual(null);
        const n = az.editProgram([
            {
                type: edit.EditOperationType.VIZ_CHANGE_POSITION,
                statement_id: 0,
                data: {
                    row: 1,
                    column: 2,
                    width: 3,
                    height: 4,
                }
            }
        ]);
        expect(n).not.toEqual(null);
        expect(n!.program.buffer.statementsLength()).toEqual(1);
        const expected = "VIZ weather_avg USING LINE (\n    pos = (x = 1, y = 2, w = 3, h = 4)\n)";
        expect(n!.program.text).toEqual(expected);
    });
});
