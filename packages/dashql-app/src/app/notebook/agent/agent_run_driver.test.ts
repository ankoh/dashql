import { startAgentRun, AgentAIClient, AgentRunParams } from './agent_run_driver.js';
import { AgentApplyDisposition, AgentHost, AgentTargetKind } from './agent_host.js';
import * as core from '../../../core/index.js';
import {
    AGENT_ATTEMPT_RESULT,
    AGENT_CANCELLED,
    AGENT_FAILED,
    AGENT_START,
    AgentIntent,
    AgentRunAction,
    AgentRunPhase,
    AgentRunState,
    reduceAgentRun,
} from './agent_run_state.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL | null = null;
let catalog: core.DashQLCatalog | null = null;

beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
beforeEach(() => {
    catalog = dql!.createCatalog();
});
afterEach(() => {
    dql!.resetUnsafe();
    catalog = null;
});

/// An AgentHost backed by the real C++ session with configurable TypeScript effects.
class FakeHost implements AgentHost {
    /// Whether visualize runs should reframe as an edit.
    createAgentSession(): core.DashQLAgentSession {
        return dql!.createAgentSession(catalog!);
    }
    /// The context block returned to the driver (asserted to reach the generation prompt).
    contextText = 'FAKE-CONTEXT';
    /// Vega-Lite transcode; defaults to wrapping the raw spec. May throw to trigger repair.
    transcodeImpl: (raw: string) => string = () => 'select 1 visualize using vegalite (mark => bar)';
    targetKind: AgentTargetKind = 'sql';
    targetName: string | null = 'the-target';

    /// Recorded calls, for assertions.
    registerRunCalls: number[] = [];
    committed: Array<{ disposition: AgentApplyDisposition; candidate: string }> = [];
    contextIntents: AgentIntent[] = [];

    buildContext(intent: AgentIntent): string {
        this.contextIntents.push(intent);
        return this.contextText;
    }
    describeTarget() {
        return { kind: this.targetKind, name: this.targetName };
    }
    transcodeVegaLite(rawSpecJson: string): string {
        return this.transcodeImpl(rawSpecJson);
    }
    applyProposal(disposition: AgentApplyDisposition, candidateText: string): void {
        this.committed.push({ disposition, candidate: candidateText });
    }
    registerRun(runId: number): void {
        this.registerRunCalls.push(runId);
    }
}

/// A mock AI client that drains canned completions in order. The classify call is matched by prompt
/// content; every other call is a generate/repair call. Can optionally abort the run's controller
/// mid-generate to exercise the cancellation path.
class MockAIClient implements AgentAIClient {
    classifyReply: string;
    completions: string[];
    prompts: string[] = [];
    /// Set by drive() from the AGENT_START payload; the mock aborts it when `abortOnGenerate` is on.
    abortController: AbortController | null = null;
    abortOnGenerate = false;

    constructor(classifyReply: string, completions: string[]) {
        this.classifyReply = classifyReply;
        this.completions = [...completions];
    }
    async generate(prompt: string, _signal: AbortSignal): Promise<string> {
        this.prompts.push(prompt);
        if (/exactly one lowercase word/.test(prompt)) {
            return this.classifyReply;
        }
        if (this.abortOnGenerate) {
            this.abortController?.abort();
        }
        return this.completions.shift() ?? '';
    }
}

interface DriveResult {
    agent: AgentRunState | null;
    actions: AgentRunAction[];
}

/// Drive a run to a terminal phase through a fake host, collecting both the reduced agent state and
/// the raw dispatched actions (the latter preserves fields the reducer drops, e.g. AGENT_FAILED's
/// `expected`). No logger is wired — the driver tolerates its absence.
async function drive(
    host: FakeHost,
    ai: MockAIClient,
    params: Partial<AgentRunParams> = {},
): Promise<DriveResult> {
    let agent: AgentRunState | null = null;
    const actions: AgentRunAction[] = [];
    let clock = 0;
    const dispatchAgent = (action: AgentRunAction) => {
        actions.push(action);
        if (action.type === AGENT_START) {
            ai.abortController = action.value.abort;
        }
        agent = reduceAgentRun(agent, action);
    };
    await startAgentRun(
        {
            runId: params.runId ?? 1,
            prompt: params.prompt ?? 'do the thing',
            // Default to a context key, but respect an explicit `null` (the no-context case) — a
            // `?? 42` here would clobber it and wrongly trip the register guard.
            contextScriptKey: 'contextScriptKey' in params ? params.contextScriptKey! : 42,
            intentOverride: params.intentOverride ?? null,
            maxAttempts: params.maxAttempts,
        },
        { aiClient: ai, host, dispatchAgent, now: () => ++clock },
    );
    return { agent, actions };
}

/// The last generate/repair prompt sent (skips the classify prompt, if any).
function lastGenerationPrompt(ai: MockAIClient): string {
    const gens = ai.prompts.filter(p => !/exactly one lowercase word/.test(p));
    expect(gens.length).toBeGreaterThan(0);
    return gens[gens.length - 1];
}

function attemptResults(actions: AgentRunAction[]): Array<{ attempt: number; candidateText: string | null; vegaLiteSpec?: string | null; errors: string[] }> {
    return actions
        .filter(a => a.type === AGENT_ATTEMPT_RESULT)
        .map(a => (a as any).value);
}

describe('startAgentRun (fake host)', () => {
    it('applies a clean SQL candidate on the first attempt', async () => {
        const host = new FakeHost();
        const ai = new MockAIClient('sql', ['select 1']);
        const { agent } = await drive(host, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        expect(agent!.attempt).toBe(1);
        expect(host.committed).toEqual([{ disposition: 'replace', candidate: 'select 1' }]);
        // The host's context block reaches the generation prompt.
        expect(lastGenerationPrompt(ai)).toContain('FAKE-CONTEXT');
        expect(host.contextIntents).toEqual(['sql']);
    });

    it('classifies via the model when no intent override is given', async () => {
        const host = new FakeHost();
        const ai = new MockAIClient('visualize', ['{"mark":"bar"}']);
        const { agent } = await drive(host, ai, { intentOverride: null });

        expect(agent!.intent).toBe('visualize');
        expect(ai.prompts.some(p => /exactly one lowercase word/.test(p))).toBe(true);
    });

    it('repairs a failing first attempt and converges on the second', async () => {
        const host = new FakeHost();
        const ai = new MockAIClient('sql', ['select (', 'select 1']);
        const { agent, actions } = await drive(host, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        expect(agent!.attempt).toBe(2);
        // The repair prompt carries the previous answer and the errors to fix.
        const repair = lastGenerationPrompt(ai);
        expect(repair).toContain('did not pass verification');
        expect(repair).toContain('select (');
        expect(repair).toContain('syntax error');
        // Only the converged candidate is committed.
        expect(host.committed).toEqual([{ disposition: 'replace', candidate: 'select 1' }]);
    });

    it('fails as expected after exhausting all attempts', async () => {
        const host = new FakeHost();
        const ai = new MockAIClient('sql', ['a', 'b', 'c']);
        const { agent, actions } = await drive(host, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.FAILED);
        expect(agent!.error).toBeTruthy();
        const failed = actions.find(a => a.type === AGENT_FAILED) as any;
        expect(failed.value.expected).toBe(true);
        expect(host.committed).toHaveLength(0);
        // Three attempts, three recorded results.
        expect(attemptResults(actions)).toHaveLength(3);
    });

    it('cancels cleanly when the run is aborted mid-generate', async () => {
        const host = new FakeHost();
        const ai = new MockAIClient('sql', ['select 1']);
        ai.abortOnGenerate = true;
        const { agent, actions } = await drive(host, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.CANCELLED);
        expect(actions.some(a => a.type === AGENT_CANCELLED)).toBe(true);
        expect(actions.some(a => a.type === AGENT_FAILED)).toBe(false);
        expect(host.committed).toHaveLength(0);
    });

    it('surfaces an unexpected host failure as an unexpected AGENT_FAILED', async () => {
        const host = new FakeHost();
        host.contextText = '';
        host.describeTarget = () => { throw new Error('catalog exploded'); };
        const ai = new MockAIClient('sql', ['select 1']);
        const { agent, actions } = await drive(host, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.FAILED);
        const failed = actions.find(a => a.type === AGENT_FAILED) as any;
        // Not an expected exhaustion — a thrown error is a real failure (logged at ERROR).
        expect(failed.value.expected).toBeFalsy();
        expect(failed.value.error).toContain('catalog exploded');
        expect(host.committed).toHaveLength(0);
    });

    it('rejects an empty candidate and repairs instead of applying nothing', async () => {
        const host = new FakeHost();
        const ai = new MockAIClient('sql', ['   ', 'select good']);
        const { agent, actions } = await drive(host, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        expect(agent!.attempt).toBe(2);
        const first = attemptResults(actions).find(r => r.attempt === 1)!;
        expect(first.errors).toEqual(['The model returned an empty result.']);
        expect(host.committed).toEqual([{ disposition: 'replace', candidate: 'select good' }]);
    });

    it('treats a transcode failure as a verifiable error and repairs', async () => {
        const host = new FakeHost();
        let t = 0;
        host.transcodeImpl = (raw) => {
            if (++t === 1) throw new Error('bad spec');
            return 'select 1 visualize using vegalite (mark => bar)';
        };
        const ai = new MockAIClient('visualize', ['{"mark":"bar"}', '{"mark":"line"}']);
        const { agent, actions } = await drive(host, ai, { intentOverride: 'visualize' });

        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        expect(agent!.attempt).toBe(2);
        // The failed attempt records the transcode error and retains the raw spec it was fed.
        const first = attemptResults(actions).find(r => r.attempt === 1)!;
        expect(first.errors[0]).toContain('bad spec');
        expect(first.vegaLiteSpec).toBe('{"mark":"bar"}');
        // The repair prompt carries the transcode error.
        expect(lastGenerationPrompt(ai)).toContain('bad spec');
        // The committed candidate is the transcoded DSL, not the raw spec.
        expect(host.committed).toEqual([{ disposition: 'create', candidate: 'select 1 visualize using vegalite (mark => bar)' }]);
    });

    it('feeds a spec-level hint for an unsupported mark into repair', async () => {
        const host = new FakeHost();
        const ai = new MockAIClient('visualize', [
            '{"mark":"pie","encoding":{"x":{"field":"x"},"y":{"field":"y"}}}',
            '{"mark":"arc","encoding":{"theta":{"field":"y"},"color":{"field":"x"}}}',
        ]);
        const { agent, actions } = await drive(host, ai, { intentOverride: 'visualize' });

        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        expect(agent!.attempt).toBe(2);
        // The failed attempt records the actionable hint returned with the transcode effect.
        const first = attemptResults(actions).find(r => r.attempt === 1)!;
        expect(first.errors[0]).toContain('no "pie" mark');
        // The repair prompt carries the hint so the model can actually correct the mark.
        const repair = lastGenerationPrompt(ai);
        expect(repair).toContain('no "pie" mark');
        expect(repair).toContain('theta');
    });

    it('reframes the visualize prompt as an edit when the host is editing a chart', async () => {
        const host = new FakeHost();
        host.targetKind = 'visualization';
        const ai = new MockAIClient('visualize', ['{"mark":"line"}']);
        await drive(host, ai, { intentOverride: 'visualize' });
        expect(lastGenerationPrompt(ai)).toContain('You are EDITING the existing chart');
    });

    it('registers the run against its context script', async () => {
        const host = new FakeHost();
        const ai = new MockAIClient('sql', ['select 1']);
        await drive(host, ai, { runId: 7, contextScriptKey: 99, intentOverride: 'sql' });
        expect(host.registerRunCalls).toEqual([7]);
    });

    it('does not register a run when there is no context script', async () => {
        const host = new FakeHost();
        const ai = new MockAIClient('sql', ['select 1']);
        await drive(host, ai, { contextScriptKey: null, intentOverride: 'sql' });
        expect(host.registerRunCalls).toHaveLength(0);
    });
});
