import { readFileSync } from 'node:fs';

import type { AgentSessionEvent, AgentSessionEventName } from '@ankoh/dashql-platform/session/agent_session_state';

const EVENTS = new Set<AgentSessionEventName>(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']);

/// The longest status line
const MAX_STATUS = 160;

/// The first line of a text, cut to the length of a status line
function oneLine(text: string): string {
    const line = text.trim().split('\n')[0] ?? '';
    return line.length > MAX_STATUS ? `${line.slice(0, MAX_STATUS - 1)}…` : line;
}

/// The SQL files that a command names
function sqlFilesOf(command: string): string[] {
    return [...command.matchAll(/[\w./@-]+\.sql\b/g)].map(match => match[0]);
}

/// A string field of an object, null without
function text(value: unknown, key: string): string | null {
    const field = value != null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
    return typeof field === 'string' ? field : null;
}

/// The text of the last message of the assistant in the transcript of Claude Code, a JSON object per line
export function lastAssistantText(transcript: string): string | null {
    let last: string | null = null;
    for (const line of transcript.split('\n')) {
        if (line.trim().length === 0) continue;
        let entry: { type?: string; message?: { content?: unknown } };
        try {
            entry = JSON.parse(line);
        } catch {
            continue;
        }
        if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
        const texts = entry.message.content.filter((block: { type?: string }) => block?.type === 'text').map((block: { text?: string }) => block.text ?? '');
        if (texts.length > 0) last = texts.join('\n');
    }
    return last;
}

/// What a tool did, in one line, and the files it touched
function toolUseOf(payload: unknown): { status: string; files: string[] } {
    const tool = text(payload, 'tool_name') ?? 'tool';
    const input = (payload as { tool_input?: unknown } | null)?.tool_input;
    const command = text(input, 'command') ?? text(input, 'cmd');
    if (command != null) return { status: oneLine(command), files: sqlFilesOf(command) };
    const file = text(input, 'file_path') ?? text(input, 'path');
    if (file != null) return { status: `${tool} ${file}`, files: [file] };
    return { status: tool, files: [] };
}

/// The event of a session from the event name and the payload of a hook, null for an event that a session ignores.
/// Claude Code and Codex pass the payload as JSON on stdin; the final message comes from the payload, else from the
/// transcript.
export function sessionEventOf(
    name: string,
    harness: string,
    payload: unknown,
    readText: (path: string) => string | null = path => { try { return readFileSync(path, 'utf8'); } catch { return null; } },
): AgentSessionEvent | null {
    if (!EVENTS.has(name as AgentSessionEventName)) return null;
    const event = name as AgentSessionEventName;
    const folder = text(payload, 'cwd') ?? '';
    switch (event) {
        case 'UserPromptSubmit':
            return { event, harness, folder, prompt: text(payload, 'prompt') ?? '' };
        case 'PostToolUse':
            return { event, harness, folder, ...toolUseOf(payload) };
        case 'Stop': {
            let message = text(payload, 'last_assistant_message');
            const transcript = text(payload, 'transcript_path');
            if (message == null && transcript != null) {
                const content = readText(transcript);
                message = content != null ? lastAssistantText(content) : null;
            }
            return { event, harness, folder, message };
        }
        default:
            return { event, harness, folder };
    }
}
