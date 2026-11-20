import { readFileSync } from 'node:fs';

import type { AgentSessionEvent, AgentSessionEventName } from '@akohn/dashql/platform/session/agent_session_state';
import { DASHQL_FOLDER, SESSION_WORKBOOK_COPIES, SESSIONS_FOLDER } from '@akohn/dashql/platform/session/session_folder';

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

/// The prefix of a path in the copy of a workbook of a page, `.dashql/sessions/<id>/workbooks/<workbook id>/`
const WORKBOOK_COPY = new RegExp(`(^|[\\s"'=])${escapeRegExp(`${DASHQL_FOLDER}/${SESSIONS_FOLDER}/`)}[^/\\s"']+/${SESSION_WORKBOOK_COPIES}/[^/\\s"']+/`, 'g');

/// The paths in a text as the page shows them: relative to the folder of the session, and in a copy of a workbook
/// relative to the copy
function shortPaths(text: string, folder: string): string {
    let short = text;
    if (folder.length > 1) {
        const prefix = folder.endsWith('/') ? folder : `${folder}/`;
        // `cd <folder> && ` in front of a command says nothing
        short = short.replace(new RegExp(`^cd\\s+(["']?)${escapeRegExp(folder)}/?\\1\\s*&&\\s*`), '');
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
    harness: string,
    payload: unknown,
    readText: (path: string) => string | null = path => { try { return readFileSync(path, 'utf8'); } catch { return null; } },
): AgentSessionEvent | null {
    const folder = text(payload, 'cwd') ?? '';
    if (name === POST_TOOL_USE_FAILURE) {
        return { event: 'PostToolUse', harness, folder, ...toolUseOf(payload, folder), toolUseId: text(payload, 'tool_use_id'), error: text(payload, 'error') ?? 'failed' };
    }
    if (!EVENTS.has(name as AgentSessionEventName)) return null;
    const event = name as AgentSessionEventName;
    switch (event) {
        case 'UserPromptSubmit':
            return { event, harness, folder, prompt: text(payload, 'prompt') ?? '' };
        case 'PreToolUse':
        case 'PostToolUse':
            return { event, harness, folder, ...toolUseOf(payload, folder), toolUseId: text(payload, 'tool_use_id') };
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

/// The tools of the harnesses that write files, with the field of the file they write
const FILE_TOOLS: Record<string, string> = { Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' };
/// The files of a patch of Codex, `*** Update File: <path>` and the like
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
/// Where the move of a file of a patch goes
const PATCH_MOVE = /^\*\*\* Move to: (.+)$/gm;

/// The files that a use of a tool writes, null for a tool that writes none or whose files are unknown
function writtenFiles(payload: unknown): string[] | null {
    const tool = text(payload, 'tool_name') ?? '';
    const input = payload != null && typeof payload === 'object' ? (payload as Record<string, unknown>).tool_input : null;
    const field = FILE_TOOLS[tool];
    if (field != null) {
        const file = text(input, field);
        return file == null ? null : [file];
    }
    // A patch of Codex names its files
    const patch = [text(input, 'patch'), text(input, 'input'), text(input, 'command')].find(value => value?.includes('*** Begin Patch'));
    if (patch == null) return null;
    return [...patch.matchAll(PATCH_FILE), ...patch.matchAll(PATCH_MOVE)].map(match => match[1].trim());
}

/// Why a harness of `dashql connect --workbook-only` may not use a tool: the tool writes files outside `copies`, the
/// absolute folder of the copies of the workbooks of the session. A relative path is relative to `cwd`, the directory
/// of the agent. Null for a tool that it may use. Commands of the shell are left to the permissions and the sandbox of
/// the harness.
export function workbookOnlyRefusal(payload: unknown, copies: string, cwd: string): string | null {
    const files = writtenFiles(payload);
    if (files == null || copies.length === 0) return null;
    const root = `${copies.replace(/\/+$/, '')}/`;
    const outside = files.filter(file => {
        const absolute = file.startsWith('/') ? file : `${cwd.replace(/\/+$/, '')}/${file}`;
        // A path that climbs out of the workbooks is outside
        const parts: string[] = [];
        for (const part of absolute.split('/')) {
            if (part === '..') parts.pop();
            else if (part !== '.' && part !== '') parts.push(part);
        }
        return !`/${parts.join('/')}`.startsWith(root);
    });
    if (outside.length === 0) return null;
    return `DashQL lets you write only into the workbooks of this session, ${root}<id>/, not ${outside.join(', ')}. Put the SQL into a script of the workbook.`;
}
