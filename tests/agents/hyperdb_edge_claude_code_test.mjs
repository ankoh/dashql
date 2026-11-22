// hyperdb-edge in Claude Code, with a fake model and no model calls (docs/wip/hyperdb_edge.md). The model calls
// hyperdb-edge through Bash, the tests check the tool results that the harness sent back and the files the commands
// left in the workspace.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { startFakeAnthropic, text, toolUse } from './fake_anthropic.mjs';
import { installEdgeSkill, SKILL_DESCRIPTION, writeEdgeCommand } from './hyperdb_edge.mjs';
import { requireLinuxSandboxTools, runHarness } from './probes.mjs';

const CLAUDE = resolve(process.env.CLAUDE_BINARY);
const ROOT = mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'hyperdb-edge-claude-'));
const EDGE = writeEdgeCommand(join(ROOT, 'bin'));

requireLinuxSandboxTools(['bwrap', 'socat']);

function contentText(content) {
    return Array.isArray(content) ? content.map(block => block.text ?? '').join('') : String(content);
}

/// Run Claude Code headless with a fake model that calls Bash with each command in turn
async function runClaude(dir, { commands, sandbox = { enabled: true }, allowedTools = ['Bash'], skill = false }) {
    const home = join(dir, 'home');
    const work = join(dir, 'work');
    mkdirSync(home, { recursive: true });
    mkdirSync(work, { recursive: true });
    if (skill) installEdgeSkill(join(home, '.claude', 'skills'));
    const model = await startFakeAnthropic({
        turn: request => {
            const done = request.messages.flatMap(m => (Array.isArray(m.content) ? m.content : [])).filter(b => b.type === 'tool_result').length;
            return done < commands.length ? [toolUse('Bash', { command: commands[done], description: 'hyperdb-edge' })] : [text('done')];
        },
    });
    try {
        const output = await runHarness(CLAUDE, [
            '-p', 'use hyperdb-edge',
            '--output-format', 'stream-json', '--verbose',
            '--settings', JSON.stringify({ sandbox }),
            // The rules take every following argument
            '--allowedTools', ...allowedTools,
        ], {
            cwd: work,
            env: {
                PATH: '/usr/bin:/bin',
                HOME: home,
                ANTHROPIC_BASE_URL: model.url,
                ANTHROPIC_API_KEY: 'sk-fake',
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
                DISABLE_AUTOUPDATER: '1',
            },
        });
        const results = output.split('\n').filter(Boolean).map(line => JSON.parse(line))
            .flatMap(event => (event.type === 'user' && Array.isArray(event.message?.content) ? event.message.content : []))
            .filter(block => block.type === 'tool_result')
            .map(block => ({ output: contentText(block.content).trim(), isError: block.is_error === true }));
        assert.equal(results.length, commands.length, `one tool result per command, got ${JSON.stringify(results)}`);
        return { results, work, requests: model.requests };
    } finally {
        await model.close();
    }
}

function caseDir(name) {
    const dir = join(ROOT, name);
    mkdirSync(dir, { recursive: true });
    return dir;
}

test('describe runs in the sandbox', async () => {
    const { results } = await runClaude(caseDir('describe'), { commands: [`${EDGE} describe`, `${EDGE} describe files`] });
    assert.equal(results[0].isError, false, results[0].output);
    assert.match(results[0].output, /^# hyperdb-edge/);
    assert.match(results[1].output, /^# files/);
});

test('run keeps a database in the workspace across calls', async () => {
    const { results, work } = await runClaude(caseDir('database'), {
        commands: [
            `${EDGE} run --db sales.hyper -c "create table sales(region text, amount int); insert into sales values ('north', 10), ('south', 20)"`,
            `${EDGE} run --db sales.hyper --format json -c "select region, amount from sales order by region"`,
        ],
    });
    assert.equal(results[0].isError, false, results[0].output);
    assert.match(results[0].output, /INSERT 2/);
    assert.equal(results[1].isError, false, results[1].output);
    assert.deepEqual(JSON.parse(results[1].output).rows, [['north', 10], ['south', 20]]);
    for (const result of results) assert.doesNotMatch(result.output, /LogFile/);
    assert.ok(existsSync(join(work, 'sales.hyper')));
    assert.ok(!existsSync(join(work, 'sales.hyper.lock')));
});

test('run writes and reads files of the workspace', async () => {
    const { results, work } = await runClaude(caseDir('files'), {
        commands: [
            `${EDGE} run -c "copy (select g from generate_series(1, 5) as s(g)) to '/mnt/external/work/five.parquet' with (format => 'parquet')"`,
            `${EDGE} run --format json -c "select count(*) as n from external('/mnt/external/work/five.parquet')"`,
        ],
    });
    assert.equal(results[0].output, 'COPY 5', results[0].output);
    assert.deepEqual(JSON.parse(results[1].output).rows, [[5]]);
    assert.ok(existsSync(join(work, 'five.parquet')));
});

test('a failing statement is an error of the tool with the message of Hyper', async () => {
    const { results } = await runClaude(caseDir('failure'), { commands: [`${EDGE} run -c "select * from missing_table"`] });
    assert.equal(results[0].isError, true, results[0].output);
    assert.match(results[0].output, /missing_table/);
    assert.match(results[0].output, /SQLSTATE 42P01/);
});

test('a rule for describe does not allow run, a rule for run does', async () => {
    // Without the sandbox, every command needs a rule, as on machines that turn the sandbox off
    const commands = [`${EDGE} describe`, `${EDGE} run -c "select 1 as a"`];
    const describeOnly = await runClaude(caseDir('rule_describe'), {
        commands, sandbox: { enabled: false }, allowedTools: [`Bash(${EDGE} describe:*)`],
    });
    assert.equal(describeOnly.results[0].isError, false, describeOnly.results[0].output);
    assert.equal(describeOnly.results[1].isError, true, describeOnly.results[1].output);
    assert.doesNotMatch(describeOnly.results[1].output, /\(1 row\)/);

    const both = await runClaude(caseDir('rule_both'), {
        commands, sandbox: { enabled: false }, allowedTools: [`Bash(${EDGE} describe:*)`, `Bash(${EDGE} run:*)`],
    });
    assert.equal(both.results[1].isError, false, both.results[1].output);
    assert.match(both.results[1].output, /\(1 row\)/);
});

test('the skill reaches the model', async () => {
    const { requests } = await runClaude(caseDir('skill'), { commands: [], skill: true });
    const main = requests.filter(request => request.tools?.some(tool => tool.name === 'Bash'));
    assert.ok(main.some(request => JSON.stringify(request).includes(SKILL_DESCRIPTION)), 'the description of the skill in a request');
});
