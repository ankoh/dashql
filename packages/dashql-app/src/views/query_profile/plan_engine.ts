import * as dashql from '@ankoh/dashql-core';

/// Values can be megabytes large, only look at the first characters
const PEEK_WINDOW = 4096;
/// Trino plans map fragment ids to plan nodes: {"0": {"id": "6", "name": "Output", ...}}
const TRINO_PLAN_RE = /^\{\s*"\d+"\s*:\s*\{\s*"id"\s*:/;
/// Hyper plans start with the operator of the root, e.g. {"tree":{"operator":...}}
const HYPER_OPERATOR_KEY = '"operator"';

/// The engine whose plan a text is, null if the text is no plan. A cheap look at the first characters, the parser
/// of the engine decides when the plan is loaded.
export function detectPlanEngine(text: string | null): dashql.buffers.profile.ProfileEngine | null {
    if (text == null) return null;
    const head = text.slice(0, PEEK_WINDOW).trimStart();
    if (!head.startsWith('{') || !text.slice(-PEEK_WINDOW).trimEnd().endsWith('}')) return null;
    if (TRINO_PLAN_RE.test(head)) return dashql.buffers.profile.ProfileEngine.TRINO;
    if (head.includes(HYPER_OPERATOR_KEY)) return dashql.buffers.profile.ProfileEngine.HYPER;
    return null;
}
