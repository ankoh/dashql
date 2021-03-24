import { analyzer } from '../src/';
import { Analyzer } from '../src/index_browser';

var analyzerBindings: analyzer.AnalyzerBindings;

beforeAll(async () => {
    analyzerBindings = new Analyzer({}, '/base/src/analyzer/analyzer_wasm.wasm');
    await analyzerBindings.init();
});

beforeEach(async () => {
    analyzerBindings.reset();
});

describe('Action Scheduler', () => {
    describe('program actions', () => {
        it('select 1', async () => {
            const program = analyzerBindings.parseProgram('select 1');
            analyzerBindings.instantiateProgram();
            expect(program.buffer.statementsLength()).toBe(1);
            const plan = analyzerBindings.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(1);
        });
    });
});
