import { AgentIntent } from './agent_prompts.js';
import type * as core from '../../../core/index.js';

/// The surface an agent run acts on. The run driver (classify → generate → verify → repair →
/// apply) is deliberately free of any knowledge about *what* it is editing — a notebook, a
/// standalone script, a document, … . Everything domain-specific is reached through this host,
/// which a caller (e.g. the notebook) implements as an adapter over its own state.
///
/// A host is constructed for a single run: it closes over the run's context (the focused
/// script, the target to apply to, how to reach the catalog) so the driver's methods take no
/// domain types. This is what lets `src/agent` stay notebook-free.
export interface AgentHost {
    /// Create the core-owned orchestration session.
    createAgentSession(): core.DashQLAgentSession;
    /// Assemble the prompt context block for the given intent (referenced-table schemas for SQL,
    /// source query + current chart + output schema for visualize, …). Returns "" when there is
    /// nothing to contribute.
    buildContext(intent: AgentIntent): string;
    /// Describe the focused target so the C++ workflow can decide whether to create or replace.
    describeTarget(): AgentTargetDescription;
    /// Transcode a raw Vega-Lite spec (the JSON the model emitted) into the target DSL, resolving
    /// and injecting the data source along the way. THROWS on a malformed spec / transcode failure
    /// so the driver treats it as a verifiable error and repairs.
    transcodeVegaLite(rawSpecJson: string): string;
    /// Execute the create/replace disposition selected by the C++ workflow.
    applyProposal(disposition: AgentApplyDisposition, candidateText: string): void;
    /// Attach this run's id to the run's context (so a UI can resolve the run — and its trace — the
    /// same way it resolves a query by id). Optional: a run with no context has nothing to attach to.
    registerRun?(runId: number): void;
}

export type AgentTargetKind = 'none' | 'sql' | 'visualization';
export type AgentApplyDisposition = 'create' | 'replace';

export interface AgentTargetDescription {
    kind: AgentTargetKind;
    name: string | null;
}
