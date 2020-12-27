import { analyzer } from '../src/index_node';
import * as path from 'path';

var analyzerBindings: analyzer.AnalyzerBindings;

beforeAll(async () => {
    analyzerBindings = new analyzer.Analyzer({}, path.resolve(__dirname, '../src/analyzer/analyzer_wasm_node.wasm'));
    await analyzerBindings.init();
});

beforeEach(async () => {
    analyzerBindings.reset();
});

describe('Action Scheduler', () => {
   describe('program actions', () => {
        test('select 1', async () => {
            const program = analyzerBindings.parseProgram("select 1");
            expect(program.buffer.statementsLength()).toBe(1);
            const plan = analyzerBindings.planProgram();
            const graph = plan!.buffer.actionGraph()!;
            expect(graph.setupActionsLength()).toBe(0);
            expect(graph.programActionsLength()).toBe(1);
        });
   });
});
