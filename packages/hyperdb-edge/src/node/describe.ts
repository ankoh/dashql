import { readFileSync } from 'node:fs';

/// The texts of describe, in describe/ of the package: two folders up from src/node/ and from dist/node/
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

/// A topic and the line of the index that says what it holds
export interface TopicSummary {
    readonly name: string;
    readonly summary: string;
}

function readText(name: string): string {
    return readFileSync(new URL(`${name}.md`, DESCRIBE_DIRECTORY), 'utf8');
}

/// The topics in the order of the index, which lists them as "- `name`: summary"
export function describeTopicSummaries(): TopicSummary[] {
    return [...readText('index').matchAll(/^- `([a-z]+)`: (.+)$/gm)].map(match => ({ name: match[1], summary: match[2] }));
}

/// The names of the topics in the order of the index
export function describeTopics(): string[] {
    return describeTopicSummaries().map(topic => topic.name);
}

/// The index without a topic, one topic, or all of them after the index
export function readDescribe(topic: string | null): string {
    if (topic == null) return readText('index');
    const topics = describeTopics();
    if (topic === 'all') return [readText('index'), ...topics.map(readText)].join('\n');
    if (!topics.includes(topic)) throw new UnknownTopicError(topic, topics);
    return readText(topic);
}
