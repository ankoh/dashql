// Copyright (c) 2021 The DashQL Authors

import { HTTPClient } from '../http_client';
import { DatabaseClient } from '../database_client';
import { AnalyzerBindings } from '../analyzer';
import { JMESPathBindings } from '../jmespath';
import { PlanContext, PlanContextAction, Logger, initialPlanContext } from '../model';
import { AsyncDuckDB } from '@duckdb/duckdb-wasm/dist/duckdb-esm';
import * as model from '../model';

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
    /// The jmespath resolver
    readonly jmespath: () => Promise<JMESPathBindings>;

    /// The plan state
    planContext: PlanContext;
    /// The pending plan state actions
    planContextDiff: PlanContextAction[];
}

export type WiredTaskExecutionContext = TaskExecutionContext & {
    planContextDispatch: model.Dispatch<model.PlanContextAction>;
};
export async function wireTaskExecutionContext(
    db: AsyncDuckDB,
    analyzer: AnalyzerBindings,
    jmespath: () => Promise<JMESPathBindings>,
): Promise<WiredTaskExecutionContext> {
    const logger = Logger.createWired();
    const database = DatabaseClient.createWired(db);
    const http = new HTTPClient(logger);
    const wired: WiredTaskExecutionContext = {
        logger,
        database,
        analyzer,
        http,
        jmespath,
        planContext: initialPlanContext,
        planContextDiff: [],
        planContextDispatch: (action: PlanContextAction) =>
            (wired.planContext = model.reducePlanContext(wired.planContext, action)),
    };
    await database.connect();
    return wired;
}
