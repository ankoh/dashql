import * as analyzer from '../src/analyzer';
import * as edit from '../src/edit';

export function testProgramEditor(az: () => analyzer.AnalyzerBindings): void {
    beforeEach(async () => {
        az().reset();
    });

    describe('Program editor', () => {
        it('add viz position', () => {
            const p = az().parseProgram('VIZ weather_avg USING LINE');
            const pi = az().instantiateProgram();
            expect(p.buffer.statementsLength()).toEqual(1);
            expect(pi).not.toEqual(null);
            const n = az().editProgram([
                {
                    type: edit.EditOperationType.UPDATE_CARD_POSITION,
                    statementID: 0,
                    data: {
                        position: {
                            row: 1,
                            column: 2,
                            width: 3,
                            height: 4,
                        },
                    },
                },
            ]);
            expect(n).not.toEqual(null);
            expect(n!.program.buffer.statementsLength()).toEqual(1);
            const expected = `VIZ weather_avg USING LINE (
    position = (
        row = 1,
        column = 2,
        width = 3,
        height = 4
    )
)`;
            expect(n!.program.text).toEqual(expected);
        });

        it('update viz position', () => {
            const p = az().parseProgram(
                `VIZ weather_avg USING LINE (
    position = (
        row = 1,
        column = 2,
        width = 3,
        height = 4
    )
)`,
            );
            const pi = az().instantiateProgram();
            expect(p.buffer.statementsLength()).toEqual(1);
            expect(pi).not.toEqual(null);
            const n = az().editProgram([
                {
                    type: edit.EditOperationType.UPDATE_CARD_POSITION,
                    statementID: 0,
                    data: {
                        position: {
                            row: 10,
                            column: 9,
                            width: 8,
                            height: 7,
                        },
                    },
                },
            ]);
            expect(n).not.toEqual(null);
            expect(n!.program.buffer.statementsLength()).toEqual(1);
            const expected = `VIZ weather_avg USING LINE (
    position = (
        row = 10,
        column = 9,
        width = 8,
        height = 7
    )
)`;
            expect(n!.program.text).toEqual(expected);
        });
    });
}
