// Copyright (c) 2021 The DashQL Authors

import { HTTPClient } from '../http_client';
import { DatabaseClient } from '../database_client';
import { AnalyzerBindings } from '../analyzer';
import { JMESPathBindings } from '../jmespath';
import { Dispatch, PlanContext, PlanContextAction, Log } from '../model';

export interface TaskExecutionContext {
    /// The log
    readonly log: Log;
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
