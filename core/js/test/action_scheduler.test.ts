import { DashQLCore } from '../';

var core: DashQLCore;

beforeAll(async () => {
    core = new DashQLCore();
    await core.init();
});

describe('Action Planner', () => {
   describe('planning', () => {
       test('select 1', async () => {
           const program = core.parseProgram("select 1");
           const plan = core.planProgram();
           const action_graph = plan!.action_graph;

           expect(action_graph.setupActionsLength()).toBe(0);
           expect(action_graph.programActionsLength()).toBe(1);
       });
   });
});
