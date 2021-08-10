import { HTTPProxy } from '../http_proxy';
import { DatabaseProxy } from '../database_proxy';
import { AnalyzerBindings } from '../analyzer';
import { JMESPathBindings } from '../jmespath';
import { TaskUpdate, Dispatch, PlanContext, PlanContextAction, Log } from '../model';

export interface TaskExecutionContext {
    /// The log
    readonly log: Log;
    /// The database
    readonly database: DatabaseProxy;
    /// The analyzer
    readonly analyzer: AnalyzerBindings;
    /// The database
    readonly http: HTTPProxy;
    /// The database
    readonly jmespath: () => Promise<JMESPathBindings>;

    /// The plan state
    planContext: PlanContext;
    /// The plan context dispatch
    planContextDispatch: Dispatch<PlanContextAction>;
    /// The pending plan state actions
    planContextDiff: PlanContextAction[];
    /// The pending task updates
    taskUpdates: TaskUpdate[];
}
