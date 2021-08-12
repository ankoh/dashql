// Copyright (c) 2021 The DashQL Authors

import { HTTPClient } from '../http_client';
import { DatabaseClient } from '../database_client';
import { AnalyzerBindings } from '../analyzer';
import { JMESPathBindings } from '../jmespath';
import { PlanContext, PlanContextAction, Logger } from '../model';

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
    /// The pending plan state actions
    planContextDiff: PlanContextAction[];
}
