import * as proto from '@dashql/proto';
import Immutable from 'immutable';
import { analyzer, jmespath, TaskSchedulerStateMachine } from '../src';
import { TEST_CASES } from './task_logic_tests';
import { InputValue, REDUCE_BATCH, SCHEDULER_STEP_DONE, SCHEDULE_PLAN, TaskSchedulerStatus } from '../src/model';
import { WiredTaskExecutionContext, wireTaskExecutionContext } from '../src/task';
import { HTTPMock, mockHTTP } from './http_mock';

import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import { hashArrowColumn } from '../src/utils/hash';

export function testTaskLogic(
    db: () => duckdb.AsyncDuckDB,
    az: () => analyzer.AnalyzerBindings,
    jpFn: () => jmespath.JMESPathBindings,
): void {
    let httpMock: HTTPMock | null = null;
    let taskCtx: WiredTaskExecutionContext;

    beforeEach(async () => {
        httpMock = mockHTTP();
        taskCtx = await wireTaskExecutionContext(db(), az(), async () => jpFn());
    });

    afterEach(async () => {
        await db().reset();
        await az().reset();

        if (httpMock != null) {
            httpMock.reset();
            httpMock = null;
        }
    });

    describe('Task Logic', () => {
        for (let i = 0; i < TEST_CASES.length; ++i) {
            const test = TEST_CASES[i];
            const taskStateMachine = new TaskSchedulerStateMachine();

            describe(test.name, () => {
                // Setup the mocks
                for (const { url, status, data } of test.mocks.http) {
                    httpMock.onGet(url).reply(status, data);
                }
                // Execute the steps
                for (const step of test.steps) {
                    it(step.name, async () => {
                        // Get the input list
                        const input = Immutable.List<InputValue>(step.input);
                        // Parse the program
                        az().parseProgram(step.text);

                        // Instantiate the program
                        const instance = az().instantiateProgram(input);
                        // Schedule the plan
                        taskCtx.planContextDispatch({
                            type: SCHEDULE_PLAN,
                            data: [az(), instance],
                        });

                        // Execute all scheduler steps
                        let status: TaskSchedulerStatus;
                        do {
                            // Advance state machine
                            const work = taskStateMachine.step(taskCtx);
                            // Reduce plan actions
                            taskCtx.planContextDispatch({
                                type: REDUCE_BATCH,
                                data: taskCtx.planContextDiff,
                            });
                            // Perform the work
                            status = await work();
                            // Perform the scheduler step
                            taskCtx.planContextDispatch({
                                type: SCHEDULER_STEP_DONE,
                                data: [status, taskCtx.planContextDiff],
                            });
                        } while (status != TaskSchedulerStatus.IDLE);

                        // Check plan context
                        const planCtx = taskCtx.planContext;
                        expect(planCtx.statementStatus.size).toEqual(2);
                        expect(planCtx.statementStatus.get(0).status).toEqual(proto.task.TaskStatusCode.COMPLETED);

                        // Check database
                        const conn = await db().connect();
                        for (const dataSpec of step.expected.data) {
                            // Match result size
                            const query = dataSpec.script;
                            const result = await conn.runQuery(query);
                            expect(result.length).toEqual(dataSpec.expected.length);
                            expect(result.numCols).toEqual(dataSpec.expected.numCols);

                            // Match result columns
                            for (let cid = 0; cid < result.numCols; ++cid) {
                                const resultCol = result.getColumnAt(cid);
                                const expectedCol = dataSpec.expected.getColumnAt(cid);
                                expect(resultCol.name).toEqual(expectedCol.name);
                                expect(hashArrowColumn(resultCol)).toEqual(hashArrowColumn(expectedCol));
                            }
                        }
                        conn.disconnect();
                    });
                }
            });
        }
    });
}
