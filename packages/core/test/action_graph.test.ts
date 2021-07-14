import { analyzer } from '../src/';

export function testActionGraph(az: () => analyzer.AnalyzerBindings): void {
    beforeAll(async () => {});
    beforeEach(async () => {
        az().reset();
    });

    describe('Action Scheduler', () => {
        describe('program actions', () => {
            it('select 1', async () => {
                const program = az().parseProgram('select 1');
                az().instantiateProgram();
                expect(program.buffer.statementsLength()).toBe(1);
                const plan = az().planProgram();
                const graph = plan!.buffer.actionGraph()!;
                expect(graph.setupActionsLength()).toBe(0);
                expect(graph.programActionsLength()).toBe(1);
            });
        });
    });
}
