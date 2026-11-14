import { readFileSync } from 'node:fs';

/// The texts of describe, in describe/ of the package: two folders up from src/cli/ and from dist/cli/
export const DESCRIBE_DIRECTORY = new URL('../../describe/', import.meta.url);

export class UnknownTopicError extends Error {
    constructor(
        readonly topic: string,
        readonly topics: string[],
    ) {
        super(`unknown topic '${topic}', the topics are ${topics.join(', ')} and all`);
        this.name = 'UnknownTopicError';
    }
}

function readText(name: string): string {
    return readFileSync(new URL(`${name}.md`, DESCRIBE_DIRECTORY), 'utf8');
}

/// The topics in the order of the index, which lists them as "- `name`: ..."
export function describeTopics(): string[] {
    return [...readText('index').matchAll(/^- `([a-z]+)`: /gm)].map(match => match[1]);
}

/// The index without a topic, one topic, or all of them after the index
export function readDescribe(topic: string | null): string {
    if (topic == null) return readText('index');
    const topics = describeTopics();
    if (topic === 'all') return [readText('index'), ...topics.map(readText)].join('\n');
    if (!topics.includes(topic)) throw new UnknownTopicError(topic, topics);
    return readText(topic);
}
