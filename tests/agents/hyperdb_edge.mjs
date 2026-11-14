// hyperdb-edge for the agent integration tests: the command as an agent calls it, and its skill
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/// The Node binary itself: in a js_test of Bazel, process.execPath is a wrapper that needs the environment of the test,
/// which a harness doesn't pass to the commands of the agent. It is the Node of the toolchain, 24.4.1, which has
/// exnref only behind a flag: the commands also check that hyperdb-edge sets it itself.
const NODE = process.env.JS_BINARY__NODE_BINARY ? resolve(process.env.JS_BINARY__NODE_BINARY) : process.execPath;

/// The compiled command and the skill in the runfiles
const MAIN = resolve('packages/hyperdb-edge/dist/cli/main.js');
const SKILL = resolve('packages/hyperdb-edge/skill/hyperdb-edge/SKILL.md');

/// Write the command `hyperdb-edge` into a folder, as npm would link it, and return its path
export function writeEdgeCommand(dir) {
    if (!existsSync(MAIN)) throw new Error(`hyperdb-edge is not built: ${MAIN}`);
    mkdirSync(dir, { recursive: true });
    const command = join(dir, 'hyperdb-edge');
    writeFileSync(command, `#!/bin/bash
exec ${JSON.stringify(NODE)} ${JSON.stringify(MAIN)} "$@"
`);
    chmodSync(command, 0o755);
    return command;
}

/// Install the skill into the skills folder of a harness, e.g. ~/.claude/skills or $CODEX_HOME/skills
export function installEdgeSkill(skillsDir) {
    const dir = join(skillsDir, 'hyperdb-edge');
    mkdirSync(dir, { recursive: true });
    copyFileSync(SKILL, join(dir, 'SKILL.md'));
}

/// The start of the description of the skill, to find it in what the harness sends the model
export const SKILL_DESCRIPTION = 'Run SQL on Hyper, the SQL engine of hyperdb-wasm';
