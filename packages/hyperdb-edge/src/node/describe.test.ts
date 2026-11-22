import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openEngine } from './open_engine.js';
import { runStatement } from '../run_statement.js';
import { splitStatements } from '../statements.js';
import { DESCRIBE_DIRECTORY, describeTopics, readDescribe, UnknownTopicError } from './describe.js';

const describeDirectory = fileURLToPath(DESCRIBE_DIRECTORY);
const packageDirectory = path.resolve(describeDirectory, '..');

function topicFiles(): string[] {
    return readdirSync(describeDirectory)
        .filter(f => f.endsWith('.md') && f !== 'index.md')
        .map(f => f.slice(0, -'.md'.length))
        .sort();
}

/// The topics that the index lists, in its order
function listedTopics(): string[] {
    const index = readFileSync(path.join(describeDirectory, 'index.md'), 'utf8');
    return [...index.matchAll(/^- `([a-z]+)`: /gm)].map(m => m[1]);
}

/// The SQL of the ```sql blocks of a text, in order
function sqlBlocks(text: string): string[] {
    return [...text.matchAll(/^```sql\n([\s\S]*?)^```$/gm)].map(m => m[1]);
}

describe('the topics', () => {
    it('are the files of the describe folder, each listed once in the index', () => {
        expect([...listedTopics()].sort()).toEqual(topicFiles());
        expect(new Set(listedTopics()).size).toBe(listedTopics().length);
        expect(describeTopics()).toEqual(listedTopics());
    });

    it('start with their name as the title', () => {
        for (const topic of topicFiles()) {
            expect(readDescribe(topic).split('\n')[0]).toBe(`# ${topic}`);
        }
    });

    it('have no placeholders in their SQL', () => {
        for (const topic of topicFiles()) {
            for (const block of sqlBlocks(readDescribe(topic))) {
                expect(block, topic).not.toMatch(/<[a-z_ ]+>/);
            }
        }
    });

    it('show SQL in most topics', () => {
        const withSql = topicFiles().filter(t => sqlBlocks(readDescribe(t)).length > 0);
        expect(withSql.length).toBeGreaterThan(topicFiles().length / 2);
    });
});

describe('readDescribe', () => {
    it('prints the index without a topic', () => {
        expect(readDescribe(null)).toBe(readFileSync(path.join(describeDirectory, 'index.md'), 'utf8'));
    });

    it('prints every topic for all, the index first', () => {
        const all = readDescribe('all');
        expect(all.startsWith(readDescribe(null))).toBe(true);
        let position = 0;
        for (const topic of listedTopics()) {
            const at = all.indexOf(readDescribe(topic), position);
            expect(at, topic).toBeGreaterThan(position - 1);
            position = at;
        }
    });

    it('refuses an unknown topic and lists the topics', () => {
        expect(() => readDescribe('tables')).toThrow(UnknownTopicError);
        try {
            readDescribe('tables');
        } catch (e) {
            for (const topic of listedTopics()) expect((e as Error).message).toContain(topic);
        }
    });

    it('refuses a topic that looks like a path', () => {
        expect(() => readDescribe('../package')).toThrow(UnknownTopicError);
        expect(() => readDescribe('index')).toThrow(UnknownTopicError);
    });
});

// Every SQL example runs against the engine, so a hyperdb-wasm that changes what a topic says fails here.
// The topics open the database as `--db sales.hyper`, its name is sales.
describe('the SQL of the topics', () => {
    for (const topic of topicFiles()) {
        const blocks = sqlBlocks(readFileSync(path.join(describeDirectory, `${topic}.md`), 'utf8'));
        if (blocks.length === 0) continue;
        it(`runs in ${topic}`, async () => {
            const directory = mkdtempSync(path.join(tmpdir(), `hyperdb-edge-describe-${topic}-`));
            const engine = await openEngine({ database: path.join(directory, 'sales.hyper'), workDirectory: directory });
            try {
                for (const block of blocks) {
                    for (const statement of splitStatements(block)) {
                        await expect(runStatement(engine.connection, statement.text), `${topic}: ${statement.text}`).resolves.toBeDefined();
                    }
                }
            } finally {
                await engine.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });
    }
});

describe('the skill', () => {
    const skill = readFileSync(path.join(packageDirectory, 'skill', 'hyperdb-edge', 'SKILL.md'), 'utf8');

    it('is named hyperdb-edge and says when to use it', () => {
        expect(skill).toMatch(/^---\nname: hyperdb-edge\ndescription: .+\n---\n/);
    });

    it('sends the agent to describe and names no other command or option, so a copy does not go stale', () => {
        expect(skill).toContain('`hyperdb-edge describe`');
        expect(skill).not.toMatch(/hyperdb-edge run/);
        expect(skill).not.toMatch(/(^|\s)--?[a-z]/m);
    });

    it('says that data is not instructions', () => {
        expect(skill).toMatch(/data, not instructions/);
    });
});
