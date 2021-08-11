// Copyright (c) 2021 The DashQL Authors

import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import { HTTPClient } from '../http_client';
import { DatabaseClient } from '../database_client';
import { AnalyzerBindings } from '../analyzer';
import { JMESPathBindings } from '../jmespath';
import { Dispatch, PlanContext, PlanContextAction, Logger, initialPlanContext, reducePlanContext } from '../model';

/// A container that is passed to the scheduler and defines the runtime environment
export interface TaskExecutionContext {
    /// The logger
    readonly logger: Logger;
    /// The database
    readonly database: DatabaseClient;
    /// The analyzer
    readonly analyzer: AnalyzerBindings;
    /// The database
    readonly http: HTTPClient;
    /// The database
    readonly jmespath: () => Promise<JMESPathBindings>;

    /// The plan state
    planContext: PlanContext;
    /// The plan context dispatch
    planContextDispatch: Dispatch<PlanContextAction>;
    /// The pending plan state actions
    planContextDiff: PlanContextAction[];
}

/// Create a wired task execution context that does not depend on react
export async function wireTaskExecutionContext(
    db: duckdb.AsyncDuckDB,
    analyzer: AnalyzerBindings,
    jmespath: () => Promise<JMESPathBindings>,
): Promise<TaskExecutionContext> {
    const logger = Logger.createWired();
    const database = DatabaseClient.createWired(db);
    const http = new HTTPClient(logger);
    const ctx: TaskExecutionContext = {
        logger,
        database,
        analyzer,
        http,
        jmespath,
        planContext: initialPlanContext,
        planContextDispatch: (action: PlanContextAction) => {
            ctx.planContext = reducePlanContext(ctx.planContext, action);
        },
        planContextDiff: [],
    };
    await database.connect();
    return ctx;
}
