// The agents of the DashQL app for the agent integration tests: the agent host of the main process
// (//packages/dashql-native:compile) with a fake page in place of the window, and the `dashql` command of the app
// (//packages/dashql-cli:dashql). The host runs a real harness for a question, the agent's commands call the page.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/// The `dashql` command of the app in the runfiles
export const DASHQL = resolve(process.env.DASHQL_BINARY);

const { AgentHost } = await import(pathToFileURL(resolve('packages/dashql-native/dist/agent/agent_host.js')).href);

/// A page that records the events of the turns and answers the calls of the agent with `answer(call)`, which returns
/// the text of stdout or throws for a failed call
export class FakePage {
    events = [];
    calls = [];
    host = null;
    #stops = [];

    constructor(answer) {
        this.answer = answer;
    }

    event(_workbookId, event) {
        this.events.push(event);
        if (event.event === 'Stop') for (const done of this.#stops.splice(0)) done(event);
    }

    call(call) {
        this.calls.push(call);
        try {
            this.host.reply(this, { callId: call.callId, out: this.answer(call), exit: 0 });
        } catch (error) {
            this.host.reply(this, { callId: call.callId, err: `error: ${error.message}\n`, exit: 1 });
        }
    }

    cancelCall() {}

    /// Resolves with the Stop of the next turn that ends
    stopped() {
        return new Promise(done => this.#stops.push(done));
    }
}

/// The agent host of the app in `root`, harnesses run with `env` and are found on `searchPath`
export function startDashQLApp({ root, env, searchPath, answer }) {
    const host = new AgentHost({ root, dashqlBinary: DASHQL, env, searchPath: async () => searchPath });
    const page = new FakePage(answer);
    page.host = host;
    return {
        host,
        page,
        /// Ask a question on a workbook and wait until its turn ended, resolves with its events
        async ask(workbookId, harness, question) {
            const first = page.events.length;
            const stopped = page.stopped();
            await host.ask({ workbookId, harness, prompt: question, question }, page);
            await stopped;
            return page.events.slice(first);
        },
        close: () => host.close(),
    };
}

/// The steps of the events of a turn: the label of every tool and whether it failed, from its end
export function stepsOf(events) {
    return events.filter(event => event.event === 'PostToolUse').map(({ status, error }) => ({ status, failed: error != null }));
}
