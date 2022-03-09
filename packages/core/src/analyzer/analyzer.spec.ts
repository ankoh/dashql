import * as analyzer from './analyzer_node';
import * as edit from '../edit';
import * as test from '../test';

describe('Program editor', () => {
    let az: analyzer.Analyzer | null = null;

    beforeAll(async () => {
        az = test.ANALYZER;
    });
    afterEach(async () => {
        az.reset();
    });

    it('add viz position', () => {
        const p = az.parseProgram('VIZ weather_avg USING LINE');
        const pi = az.instantiateProgram();
        expect(p.buffer.statementsLength()).toEqual(1);
        expect(pi).not.toEqual(null);
        const n = az.editProgram([
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
        const p = az.parseProgram(
            `VIZ weather_avg USING LINE (
    position = (
        row = 1,
        column = 2,
        width = 3,
        height = 4
    )
)`,
        );
        const pi = az.instantiateProgram();
        expect(p.buffer.statementsLength()).toEqual(1);
        expect(pi).not.toEqual(null);
        const n = az.editProgram([
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

describe('Parser', () => {
    let az: analyzer.Analyzer | null = null;

    beforeAll(async () => {
        az = test.ANALYZER;
    });
    afterEach(async () => {
        az.reset();
    });

    describe('errors', () => {
        it('syntax error', async () => {
            const r = az.parseProgram('?');
            const p = r.buffer;
            expect(p.statementsLength()).toEqual(0);
            expect(p.errorsLength()).toEqual(1);
        });
    });

    describe('single statements', () => {
        it('select 1', async () => {
            const r = az.parseProgram(`
            select 1;
        `);
            const p = r.buffer;
            expect(p.errorsLength()).toEqual(0);
            expect(p.statementsLength()).toEqual(1);
        });

        it('fetch http from url', async () => {
            const r = az.parseProgram(`
                FETCH weather_csv FROM http (
                    url = 'https://localhost/test'
                );
        `);
            const p = r.buffer;
            expect(p.errorsLength()).toEqual(0);
            expect(p.statementsLength()).toEqual(1);
        });
    });
});

describe('Task Graph', () => {
    let az: analyzer.Analyzer | null = null;

    beforeAll(async () => {
        az = test.ANALYZER;
    });
    afterEach(async () => {
        az.reset();
    });

    describe('program tasks', () => {
        it('select 1', async () => {
            const program = az.parseProgram('create table foo as select 1');
            az.instantiateProgram();
            expect(program.buffer.statementsLength()).toBe(1);
            const plan = az.planProgram();
            const graph = plan!.buffer.taskGraph()!;
            expect(graph.setupTasksLength()).toBe(0);
            expect(graph.programTasksLength()).toBe(1);
        });
    });
});
