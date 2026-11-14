import { edgeTools, type EdgeTool } from '../tools.js';
import { describeTopicSummaries, readDescribe } from './describe.js';
import type { EdgeSession } from './session.js';

/// The tools run_sql and describe on a session
export function sessionTools(session: EdgeSession): EdgeTool[] {
    return edgeTools({
        run: (sql, options) => session.run(sql, options),
        describe: topic => readDescribe(topic),
        topics: describeTopicSummaries(),
        databaseName: session.databaseName,
        maxRows: session.defaultMaxRows,
    });
}
