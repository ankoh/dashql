// The tools of hyperdb-edge in the Claude Agent SDK, as an MCP server in the process of the test, with a fake model
// and no model calls (docs/wip/hyperdb_edge.md). The SDK runs the pinned Claude Code, without its built-in tools.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { startFakeAnthropic, text, toolResults, toolUse } from './fake_anthropic.mjs';
import { importEdge, toolResultText } from './hyperdb_edge.mjs';

const { EdgeSession } = await importEdge('node/session.js');
const { sessionTools } = await importEdge('node/session_tools.js');
const { agentSdkServer, agentSdkToolNames } = await importEdge('adapters/claude_agent_sdk.js');

const CLAUDE = resolve(process.env.CLAUDE_BINARY);
const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'hyperdb-edge-agent-sdk-'));
const RUN_SQL = 'mcp__hyperdb__run_sql';
const DESCRIBE = 'mcp__hyperdb__describe';

let session;
let work;

before(async () => {
    work = join(ROOT, 'work');
    mkdirSync(work, { recursive: true });
    session = await EdgeSession.open({ workDirectory: work, database: 'sales.hyper' });
});

after(() => session?.close());

/// Run the Agent SDK with a fake model that plays the given turns of tool calls, then answers with a text
async function runTurns(name, turns, { allowedTools } = {}) {
    const home = join(ROOT, name);
    mkdirSync(home, { recursive: true });
    const model = await startFakeAnthropic({
        mainTool: RUN_SQL,
        turn: (request, index) => (index < turns.length ? turns[index] : [text('done')]),
    });
    const tools = sessionTools(session);
    try {
        let result = null;
        for await (const message of query({
            prompt: 'use hyperdb',
            options: {
                tools: [],
                mcpServers: { hyperdb: agentSdkServer(tools) },
                allowedTools: allowedTools ?? agentSdkToolNames(tools),
                pathToClaudeCodeExecutable: CLAUDE,
                cwd: work,
                env: {
                    PATH: '/usr/bin:/bin',
                    HOME: home,
                    ANTHROPIC_BASE_URL: model.url,
                    ANTHROPIC_API_KEY: 'sk-fake',
                    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
                    DISABLE_AUTOUPDATER: '1',
                },
            },
        })) {
            if (message.type === 'result') result = message;
        }
        assert.equal(result?.subtype, 'success', JSON.stringify(result));
        const main = model.requests.filter(request => request.tools?.some(tool => tool.name === RUN_SQL));
        return { results: main.slice(1).map(request => toolResults(request)), requests: main };
    } finally {
        await model.close();
    }
}

test('the tools reach the model with their full schemas and no built-in tools', async () => {
    const { requests } = await runTurns('schemas', []);
    const tools = Object.fromEntries(requests[0].tools.map(tool => [tool.name, tool]));
    assert.ok(RUN_SQL in tools && DESCRIBE in tools, JSON.stringify(Object.keys(tools)));
    assert.ok(!('Bash' in tools));
    // alwaysLoad: the schemas are in the first request, not deferred behind tool search
    assert.deepEqual(tools[RUN_SQL].input_schema.required, ['sql']);
    assert.ok(tools[DESCRIBE].input_schema.properties.topic.enum.includes('files'));
    assert.match(tools[RUN_SQL].description, /The database sales is open/);
});

test('the calls of one turn run in the order of the model', async () => {
    const { results } = await runTurns('order', [
        [
            toolUse(RUN_SQL, { sql: "create table orders(id int, region text); insert into orders values (1, 'north'), (2, 'south')" }, 'toolu_a'),
            toolUse(RUN_SQL, { sql: 'select count(*) as n from orders' }, 'toolu_b'),
            toolUse(DESCRIBE, { topic: 'files' }, 'toolu_c'),
        ],
    ]);
    const [turn] = results;
    assert.deepEqual(turn.map(result => result.tool_use_id), ['toolu_a', 'toolu_b', 'toolu_c']);
    assert.equal(toolResultText(turn[0]), 'CREATE\n\nINSERT 2');
    assert.match(toolResultText(turn[1]), /^n\n-\n2\n\(1 row\)$/);
    assert.match(toolResultText(turn[2]), /^# files/);
    for (const result of turn) assert.notEqual(result.is_error, true, toolResultText(result));
});

test('a failing statement is an error result, and the next turn goes on', async () => {
    const { results } = await runTurns('failure', [
        [toolUse(RUN_SQL, { sql: 'select * from missing_table' })],
        [toolUse(RUN_SQL, { sql: 'select 42 as answer' })],
    ]);
    assert.equal(results[0][0].is_error, true);
    assert.match(toolResultText(results[0][0]), /SQLSTATE 42P01/);
    assert.notEqual(results[1][0].is_error, true);
    assert.match(toolResultText(results[1][0]), /42/);
});

test('allowedTools without run_sql refuses its calls, the SQL never runs', async () => {
    const { results } = await runTurns(
        'refused',
        [[toolUse(RUN_SQL, { sql: 'create table refused_table(a int)' }), toolUse(DESCRIBE, { topic: 'catalog' })]],
        { allowedTools: [DESCRIBE] },
    );
    const [turn] = results;
    assert.equal(turn[0].is_error, true, toolResultText(turn[0]));
    assert.notEqual(turn[1].is_error, true, toolResultText(turn[1]));
    const check = await session.run("select count(*) as n from pg_catalog.pg_tables where tablename = 'refused_table'");
    assert.match(check.stdout, /\n0\n/);
});
