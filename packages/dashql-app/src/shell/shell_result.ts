import * as arrow from 'apache-arrow';

import type { DashQLShellCommand } from './api.js';
import { QueryType, type QueryMetadata } from '../query/query_execution_state.js';
import { detectPlanEngine } from '../views/query_profile/plan_engine.js';

/// The metadata of the queries that users enter in the shell
export const SHELL_QUERY_METADATA: QueryMetadata = {
    queryType: QueryType.USER_PROVIDED,
    title: 'Shell Query',
    description: null,
    issuer: 'DashQL Shell',
    userProvided: true,
};

/// Report a timing to an optional observer, observers must not interrupt the query execution
export function reportShellTiming(onTiming: ((label: string, elapsedMs: number) => void) | undefined, label: string, elapsedMs: number): void {
    try {
        onTiming?.(label, elapsedMs);
    } catch {
        // Timing observers must not interrupt query execution.
    }
}

export function getPlanResultText(table: arrow.Table | null): string | null {
    if (table == null || table.numRows !== 1 || table.numCols !== 1) return null;
    const value = table.getChildAt(0)?.get(0);
    if (typeof value !== 'string') return null;
    if (detectPlanEngine(value) == null) return null;
    try {
        const parsed = JSON.parse(value);
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        // A Hyper plan has a root operator, a Trino plan maps fragment ids to plan nodes
        const isHyperPlan = typeof parsed.operator === 'string';
        const isTrinoPlan = Object.values(parsed).every(node =>
            node != null && typeof node === 'object' && typeof (node as { name?: unknown }).name === 'string');
        return isHyperPlan || isTrinoPlan ? value : null;
    } catch {
        return null;
    }
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
