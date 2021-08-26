import * as analyzer from './analyzer_node';
import * as test from '../test';

describe('Task Graph', () => {
    let az: analyzer.Analyzer | null = null;

    beforeEach(async () => {
        if (az == null) {
            az = await test.initAnalyzer();
        }
        az.reset();
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
