import { jest } from '@jest/globals';
import * as analyzer from './analyzer/analyzer_node';
import * as jmespath from './jmespath/jmespath_node';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as test_env from './test';
import { SCENARIOS } from './task_scheduler_scenarios';
import Immutable from 'immutable';
import { TaskSchedulerStateMachine } from './task_scheduler';
import { InputValue, REDUCE_BATCH, SCHEDULER_STEP_DONE, SCHEDULE_PLAN, TaskSchedulerStatus } from './model';
import { WiredTaskExecutionContext, wireTaskExecutionContext } from './task';
import { HTTPMock, mockHTTP } from './test';
import { hashArrowColumn } from './utils/hash';
import { isSubset } from './utils';

jest.setTimeout(10000);

describe('Task Scheduler Scenarios', () => {
    const taskStateMachine = new TaskSchedulerStateMachine();
    let db: duckdb.AsyncDuckDB | null = null;
    let az: analyzer.Analyzer | null = null;
    let jp: jmespath.JMESPath | null = null;

    let dbConn: duckdb.AsyncConnection | null = null;
    let taskCtx: WiredTaskExecutionContext = null;
    let httpMock: HTTPMock | null = null;

    beforeAll(async () => {
        az = await test_env.initAnalyzer();
        db = await test_env.initDuckDB();
        jp = await test_env.initJMESPath();
    });

    beforeEach(async () => {
        dbConn = await db.connect();
        taskCtx = await wireTaskExecutionContext(db, az, async () => jp);
        httpMock = mockHTTP();
    });

    afterEach(async () => {
        httpMock.reset();
        await dbConn.disconnect();
        await db.reset();
        await az.reset();
    });

    afterAll(async () => {
        await db.terminate();
    });

    for (const scenario of SCENARIOS) {
        describe(scenario.name, () => {
            // Execute the steps
            for (let stepId = 0; stepId < scenario.steps.length; ++stepId) {
                const step = scenario.steps[stepId];
                it(stepId.toString(), async () => {
                    // Setup the mocks
                    for (const { url, status, data } of scenario.mocks.http) {
                        httpMock.onGet(url).reply(status, data);
                    }
                    // Get the input list
                    const input = Immutable.List<InputValue>(step.input);
                    // Parse the program
                    az.parseProgram(step.text);

                    // Instantiate the program
                    const instance = az.instantiateProgram(input);
                    // Schedule the plan
                    taskCtx.planContextDispatch({
                        type: SCHEDULE_PLAN,
                        data: [az, instance],
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
                    expect(planCtx.statementStatus.size).toEqual(step.expected.status.length);
                    for (let j = 0; j < step.expected.status.length; ++j) {
                        const have = planCtx.statementStatus.get(j);
                        const expected = step.expected.status[j];
                        expect(have.status).toEqual(expected.status);
                    }

                    // Check cards
                    const expectedCards = step.expected.cards || [];
                    expect(planCtx.cards.size).toBeGreaterThanOrEqual(expectedCards.length);
                    for (const expected of expectedCards) {
                        expect(planCtx.cards.has(expected.objectId)).toBe(true);
                        const have = planCtx.cards.get(expected.objectId);
                        // console.log([...planCtx.cards.keySeq()]);
                        // console.log(`Expected: ${JSON.stringify(expected)}`);
                        // console.log(`Have: ${JSON.stringify(have)}`);
                        // console.log(`Cards: ${JSON.stringify(planCtx.cards)}`);
                        expect(isSubset(expected, have)).toBe(true);
                    }

                    // Check database
                    for (const dataSpec of step.expected.data) {
                        // Match result size
                        const query = dataSpec.script;
                        const result = await dbConn.runQuery(query);
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
                });
            }
        });
    }
});
