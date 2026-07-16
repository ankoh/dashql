import { AgentIntent } from './agent_prompts.js';
import { VerifyResult } from './agent_verify.js';

/// The surface an agent run acts on. The run driver (classify → generate → verify → repair →
/// apply) is deliberately free of any knowledge about *what* it is editing — a notebook, a
/// standalone script, a document, … . Everything domain-specific is reached through this host,
/// which a caller (e.g. the notebook) implements as an adapter over its own state.
///
/// A host is constructed for a single run: it closes over the run's context (the focused
/// script, the target to apply to, how to reach the catalog) so the driver's methods take no
/// domain types. This is what lets `src/agent` stay notebook-free.
export interface AgentHost {
    /// Assemble the prompt context block for the given intent (referenced-table schemas for SQL,
    /// source query + current chart + output schema for visualize, …). Returns "" when there is
    /// nothing to contribute.
    buildContext(intent: AgentIntent): string;
    /// Is the visualize run editing an existing chart (as opposed to creating one)? Reframes the
    /// visualize prompt from "generate" to "edit". Irrelevant for SQL runs.
    isEditingChart(): boolean;
    /// Transcode a raw Vega-Lite spec (the JSON the model emitted) into the target DSL, resolving
    /// and injecting the data source along the way. THROWS on a malformed spec / transcode failure
    /// so the driver treats it as a verifiable error and repairs.
    transcodeVegaLite(rawSpecJson: string): string;
    /// Verify a candidate script against the parser + analyzer (the loop's safety net whose errors
    /// feed the next repair prompt).
    verify(candidateText: string): VerifyResult;
    /// Plan how the verified candidate is applied (in-place edit vs. new entry) without committing
    /// yet — the driver reads `inPlace`/`targetName` to word the progress log, then calls `commit`.
    planApply(intent: AgentIntent, candidateText: string): AgentApplyPlan;
    /// Attach this run's id to the run's context (so a UI can resolve the run — and its trace — the
    /// same way it resolves a query by id). Optional: a run with no context has nothing to attach to.
    registerRun?(runId: number): void;
}

/// A staged plan for applying a verified candidate. Split from `commit` so the driver can log what
/// it is about to do (and how) before mutating anything.
export interface AgentApplyPlan {
    /// True → the candidate replaces the focused target in place; false → it creates a new entry.
    inPlace: boolean;
    /// The display name of the in-place target (for the progress log), or null for a create.
    targetName: string | null;
    /// Apply the result. Called once, after the driver has logged the APPLYING phase.
    commit(): void;
}
