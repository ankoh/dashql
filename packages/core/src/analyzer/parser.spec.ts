import * as analyzer from './analyzer_node';
import * as test from '../test';

describe('Parser', () => {
    let az: analyzer.Analyzer | null = null;

    beforeAll(async () => {
        az = await test.initAnalyzer();
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
