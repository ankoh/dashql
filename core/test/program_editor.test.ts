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
    test('add viz position', () => {
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

    test('update viz position', () => {
        const p = az.parseProgram("VIZ weather_avg USING LINE (\n    pos = (x = 1, y = 2, w = 3, h = 4)\n)");
        const pi = az.instantiateProgram();
        expect(p.buffer.statementsLength()).toEqual(1);
        expect(pi).not.toEqual(null);
        const n = az.editProgram([
            {
                type: edit.EditOperationType.VIZ_CHANGE_POSITION,
                statement_id: 0,
                data: {
                    row: 10,
                    column: 9,
                    width: 8,
                    height: 7,
                }
            }
        ]);
        expect(n).not.toEqual(null);
        expect(n!.program.buffer.statementsLength()).toEqual(1);
        const expected = "VIZ weather_avg USING LINE (\n    pos = (x = 10, y = 9, w = 8, h = 7)\n)";
        expect(n!.program.text).toEqual(expected);
    });
});
