import Immutable from 'immutable';
import { analyzer, jmespath, TaskSchedulerStateMachine } from '../src';
import { TEST_CASES } from './task_scheduler_test_cases';
import { InputValue, REDUCE_BATCH, SCHEDULER_STEP_DONE, SCHEDULE_PLAN, TaskSchedulerStatus } from '../src/model';
import { WiredTaskExecutionContext, wireTaskExecutionContext } from '../src/task';
import { HTTPMock, mockHTTP } from './http_mock';

import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';

export function testTaskScheduler(
    db: () => duckdb.AsyncDuckDB,
    az: () => analyzer.AnalyzerBindings,
    jp: () => jmespath.JMESPathBindings,
): void {
    let httpMock: HTTPMock | null = null;
    let taskCtx: WiredTaskExecutionContext;

    beforeEach(async () => {
        httpMock = mockHTTP();
        taskCtx = await wireTaskExecutionContext(db(), az(), async () => jp());
    });

    afterEach(async () => {
        await db().reset();
        await az().reset();

        if (httpMock != null) {
            httpMock.reset();
            httpMock = null;
        }
    });

    describe('Task Scheduler', () => {
        for (let i = 0; i < TEST_CASES.length; ++i) {
            const test = TEST_CASES[i];
            const taskStateMachine = new TaskSchedulerStateMachine();

            describe(test.name, () => {
                // Setup the mocks
                for (const [url, data] of test.mocks.http) {
                    httpMock.onGet(url).reply(200, data);
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

                        // XXX Check state
                    });
                }
            });
        }
    });
}
