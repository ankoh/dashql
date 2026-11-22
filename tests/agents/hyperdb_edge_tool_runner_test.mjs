// The tools of hyperdb-edge in the Tool Runner of the Anthropic SDK, with a fake model and no model calls
// (docs/wip/hyperdb_edge.md). The runner runs the tools of a turn at once; the session runs their statements one call
// after another, and the tests check the tool results that the runner sent back to the model.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import Anthropic from '@anthropic-ai/sdk';

import { startFakeAnthropic, text, toolResults, toolUse } from './fake_anthropic.mjs';
import { importEdge, toolResultText } from './hyperdb_edge.mjs';

const { EdgeSession } = await importEdge('node/session.js');
const { sessionTools } = await importEdge('node/session_tools.js');
const { anthropicTools } = await importEdge('adapters/anthropic.js');

const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'hyperdb-edge-tool-runner-'));

let session;

before(async () => {
    const work = join(ROOT, 'work');
    mkdirSync(work, { recursive: true });
    session = await EdgeSession.open({ workDirectory: work, database: 'sales.hyper' });
});

after(() => session?.close());

/// Run the Tool Runner with a fake model that plays the given turns of tool calls, then answers with a text
async function runTurns(turns) {
    const model = await startFakeAnthropic({
        mainTool: 'run_sql',
        turn: (request, index) => (index < turns.length ? turns[index] : [text('done')]),
    });
    try {
        const client = new Anthropic({ baseURL: model.url, apiKey: 'sk-fake', maxRetries: 0 });
        const final = await client.beta.messages.toolRunner({
            model: 'claude-opus-5-5',
            max_tokens: 1024,
            tools: anthropicTools(sessionTools(session)),
            messages: [{ role: 'user', content: 'use hyperdb' }],
        });
        assert.deepEqual(final.content, [{ type: 'text', text: 'done' }]);
        // The tool results of turn i are in request i + 1
        const results = model.requests.slice(1).map(request => toolResults(request));
        return { results, requests: model.requests };
    } finally {
        await model.close();
    }
}

test('the tools reach the model with their schemas', async () => {
    const { requests } = await runTurns([]);
    const tools = Object.fromEntries(requests[0].tools.map(tool => [tool.name, tool]));
    assert.deepEqual(Object.keys(tools).sort(), ['describe', 'run_sql']);
    assert.equal(tools.run_sql.input_schema.additionalProperties, false);
    assert.deepEqual(tools.run_sql.input_schema.required, ['sql']);
    assert.match(tools.run_sql.description, /The database sales is open/);
    assert.ok(tools.describe.input_schema.properties.topic.enum.includes('files'));
});

test('the calls of one turn run one after another in the order of the model', async () => {
    const { results } = await runTurns([
        [
            toolUse('run_sql', { sql: "create table orders(id int, region text); insert into orders values (1, 'north'), (2, 'south')" }, 'toolu_a'),
            toolUse('run_sql', { sql: 'select count(*) as n from orders' }, 'toolu_b'),
            toolUse('describe', { topic: 'files' }, 'toolu_c'),
        ],
    ]);
    const [turn] = results;
    assert.deepEqual(turn.map(result => result.tool_use_id), ['toolu_a', 'toolu_b', 'toolu_c']);
    // The layout of the results is the test of format.ts
    assert.match(toolResultText(turn[0]), /INSERT 2/);
    // The select ran after the insert of the call before it
    assert.match(toolResultText(turn[1]), /\b2\b/);
    assert.match(toolResultText(turn[2]), /^# files/);
    for (const result of turn) assert.notEqual(result.is_error, true, toolResultText(result));
});

test('a failing statement is an error result, and the next turn goes on', async () => {
    const { results } = await runTurns([
        [toolUse('run_sql', { sql: 'select * from missing_table' })],
        [toolUse('run_sql', { sql: 'select 42 as answer' })],
    ]);
    assert.equal(results[0][0].is_error, true);
    assert.match(toolResultText(results[0][0]), /missing_table/);
    assert.match(toolResultText(results[0][0]), /SQLSTATE 42P01/);
    assert.notEqual(results[1][0].is_error, true);
    assert.match(toolResultText(results[1][0]), /42/);
});

test('max_rows cuts the rows of a result', async () => {
    const { results } = await runTurns([[toolUse('run_sql', { sql: 'select g from generate_series(1, 50) as s(g) order by g', max_rows: 3 })]]);
    assert.match(toolResultText(results[0][0]), /\(50 rows, 3 shown\)/);
    assert.doesNotMatch(toolResultText(results[0][0]), /\b4\b/);
});

test('an unknown topic is an error result', async () => {
    const { results } = await runTurns([[toolUse('describe', { topic: 'tables' })]]);
    assert.equal(results[0][0].is_error, true);
});
