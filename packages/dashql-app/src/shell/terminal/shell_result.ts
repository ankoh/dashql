import * as arrow from 'apache-arrow';

import type { DashQLShellCommand } from './api.js';
import type { QueryMetadataView } from '@akohn/dashql';
import { QueryType } from '@akohn/dashql/platform/query/query_execution_state';
import { detectPlanEngine } from '@akohn/dashql-react/utils/plan_engine';

/// The metadata of the queries that users enter in the shell
export const SHELL_QUERY_METADATA: QueryMetadataView = {
    queryType: QueryType.USER_PROVIDED,
    title: 'Shell Query',
    description: null,
    issuer: 'DashQL Shell',
    userProvided: true,
};

/// The plan text of a result of one row with one string column, null if the value is no plan. The parser of the
/// engine decides when the plan is loaded.
export function getPlanResultText(table: arrow.Table | null): string | null {
    if (table == null || table.numRows !== 1 || table.numCols !== 1) return null;
    const value = table.getChildAt(0)?.get(0);
    if (typeof value !== 'string') return null;
    return detectPlanEngine(value) == null ? null : value;
}

/// Open the last result again. `reopen` tells whether there is one.
export function createShellLastCommand(reopen: () => boolean): DashQLShellCommand {
    return [
        'last',
        'Show the last query result again',
        args => {
            if (args.length > 0) throw new Error('usage: .last');
            return reopen() ? undefined : 'No result to show';
        },
    ];
}
