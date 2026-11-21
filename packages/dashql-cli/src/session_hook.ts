import { readFileSync } from 'node:fs';

import type { AgentSessionEvent, AgentSessionEventName } from '@akohn/dashql/platform/session/agent_session_state';
import { SESSION_FOLDER_PATH, SESSION_WORKBOOK_COPIES } from '@akohn/dashql/platform/session/session_folder';

const EVENTS = new Set<AgentSessionEventName>(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd']);
/// The hook of Claude Code after a tool that failed, a PostToolUse with the error for a session
const POST_TOOL_USE_FAILURE = 'PostToolUseFailure';

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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/// The prefix of a path in the copy of a workbook of a page, `.dashql/session/workbooks/<workbook id>/`
const WORKBOOK_COPY = new RegExp(`(^|[\\s"'=])${escapeRegExp(`${SESSION_FOLDER_PATH}/${SESSION_WORKBOOK_COPIES}/`)}[^/\\s"']+/`, 'g');

/// The paths in a text as the page shows them: relative to the folder of the session, and in a copy of a workbook
/// relative to the copy
function shortPaths(text: string, folder: string): string {
    let short = text;
    if (folder.length > 1) {
        const prefix = folder.endsWith('/') ? folder : `${folder}/`;
        // `cd <folder> && ` in front of a command says nothing, nor `--workspace <folder>` (`-w`) of a command of dashql
        short = short.replace(new RegExp(`^cd\\s+(["']?)${escapeRegExp(folder)}/?\\1\\s*&&\\s*`), '');
        short = short.replace(new RegExp(`\\s(?:--workspace(?:\\s+|=)|-w\\s+)(["']?)(?:${escapeRegExp(folder)}/?|\\.)\\1(?=\\s|$)`, 'g'), '');
        short = short.split(prefix).join('');
    }
    return short.replace(WORKBOOK_COPY, '$1');
}

/// The files of a patch of Codex, `*** Update File: <path>`
function patchFilesOf(patch: string): string[] {
    return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(match => match[1].trim());
}

/// What a tool does, in one line with short paths, and the files it touches as the tool names them
function toolUseOf(payload: unknown, folder: string): { status: string; files: string[] } {
    const tool = text(payload, 'tool_name') ?? 'tool';
    const input = (payload as { tool_input?: unknown } | null)?.tool_input;
    const command = text(input, 'command') ?? text(input, 'cmd') ?? (typeof input === 'string' ? input : null);
    if (command != null && command.trimStart().startsWith('*** Begin Patch')) {
        const files = patchFilesOf(command);
        return { status: oneLine(shortPaths(`${tool} ${files.join(', ')}`, folder)), files };
    }
    if (command != null) return { status: oneLine(shortPaths(command.trim(), folder)), files: sqlFilesOf(command) };
    const file = text(input, 'file_path') ?? text(input, 'notebook_path');
    if (file != null) return { status: oneLine(`${tool} ${shortPaths(file, folder)}`), files: [file] };
    // A search, a fetch or a subagent tells what it looks for, before the folder that a search looks in
    const subject = text(input, 'pattern') ?? text(input, 'query') ?? text(input, 'url') ?? text(input, 'description');
    if (subject != null) return { status: oneLine(`${tool} ${shortPaths(subject, folder)}`), files: [] };
    const path = text(input, 'path');
    if (path != null) return { status: oneLine(`${tool} ${shortPaths(path, folder)}`), files: [path] };
    return { status: tool, files: [] };
}

/// The event of a session from the event name and the payload of a hook, null for an event that a session ignores.
/// Claude Code and Codex pass the payload as JSON on stdin; the final message comes from the payload, else from the
/// transcript.
export function sessionEventOf(
    name: string,
    payload: unknown,
    readText: (path: string) => string | null = path => { try { return readFileSync(path, 'utf8'); } catch { return null; } },
): AgentSessionEvent | null {
    const folder = text(payload, 'cwd') ?? '';
    if (name === POST_TOOL_USE_FAILURE) {
        return { event: 'PostToolUse', ...toolUseOf(payload, folder), toolUseId: text(payload, 'tool_use_id'), error: text(payload, 'error') ?? 'failed' };
    }
    if (!EVENTS.has(name as AgentSessionEventName)) return null;
    const event = name as AgentSessionEventName;
    switch (event) {
        case 'UserPromptSubmit':
            return { event, prompt: text(payload, 'prompt') ?? '' };
        case 'PreToolUse':
        case 'PostToolUse':
            return { event, ...toolUseOf(payload, folder), toolUseId: text(payload, 'tool_use_id') };
        case 'Stop': {
            let message = text(payload, 'last_assistant_message');
            const transcript = text(payload, 'transcript_path');
            if (message == null && transcript != null) {
                const content = readText(transcript);
                message = content != null ? lastAssistantText(content) : null;
            }
            return { event, message };
        }
        default:
            return { event };
    }
}
