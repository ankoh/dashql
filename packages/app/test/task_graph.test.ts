import * as analyzer from '../src/analyzer';

export function testTaskGraph(az: () => analyzer.AnalyzerBindings): void {
    beforeAll(async () => {});
    beforeEach(async () => {
        az().reset();
    });

    describe('Task Scheduler', () => {
        describe('program tasks', () => {
            it('select 1', async () => {
                const program = az().parseProgram('create table foo as select 1');
                az().instantiateProgram();
                expect(program.buffer.statementsLength()).toBe(1);
                const plan = az().planProgram();
                const graph = plan!.buffer.taskGraph()!;
                expect(graph.setupTasksLength()).toBe(0);
                expect(graph.programTasksLength()).toBe(1);
            });
        });
    });
}
