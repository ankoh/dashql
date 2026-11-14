// A fake of the Messages API of Anthropic for Claude Code under the Claude Agent SDK, after
// tests/agents/fake_anthropic.mjs of DashQL. A test scripts the turns of the main conversation, the one whose requests
// offer the tool `mainTool`; every other request (titles, summaries, token counts) gets a short answer.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type ContentBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };

/// A request to the fake, as Claude Code sent it
export interface FakeRequest {
    url: string;
    model?: string;
    stream?: boolean;
    tools?: Array<{ name: string }>;
    messages?: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
}

/// A text block of a scripted turn
export const text = (value: string): ContentBlock => ({ type: 'text', text: value });

let toolUses = 0;
/// A tool call of a scripted turn
export const toolUse = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `toolu_${String(++toolUses).padStart(6, '0')}`, name, input });

function events(id: string, content: ContentBlock[], stopReason: string): Array<[string, Record<string, unknown>]> {
    const out: Array<[string, Record<string, unknown>]> = [
        ['message_start', { message: { id, type: 'message', role: 'assistant', model: 'fake', content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 1 } } }],
    ];
    content.forEach((block, index) => {
        if (block.type === 'text') {
            out.push(['content_block_start', { index, content_block: { type: 'text', text: '' } }]);
            out.push(['content_block_delta', { index, delta: { type: 'text_delta', text: block.text } }]);
        } else {
            out.push(['content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }]);
            out.push(['content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }]);
        }
        out.push(['content_block_stop', { index }]);
    });
    out.push(['message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } }]);
    out.push(['message_stop', {}]);
    return out;
}

function reply(res: http.ServerResponse, request: FakeRequest, id: string, content: ContentBlock[]): void {
    const stopReason = content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn';
    if (request.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        for (const [type, data] of events(id, content, stopReason)) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        res.end();
    } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: 'fake', content, stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } }));
    }
}

export interface FakeAnthropic {
    readonly url: string;
    /// Every request, in order
    readonly requests: FakeRequest[];
    /// The requests of the main conversation
    readonly main: FakeRequest[];
    close(): Promise<void>;
}

/// Start the fake. `turn(request)` returns the content blocks of the next turn of the main conversation.
export async function startFakeAnthropic(options: { mainTool: string; turn: (request: FakeRequest) => ContentBlock[] }): Promise<FakeAnthropic> {
    const requests: FakeRequest[] = [];
    const main: FakeRequest[] = [];
    let replies = 0;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
        });
        req.on('end', () => {
            let parsed: Omit<FakeRequest, 'url'> = {};
            try {
                parsed = JSON.parse(body);
            } catch {
                // Not JSON
            }
            const request: FakeRequest = { url: req.url ?? '', ...parsed };
            requests.push(request);
            if (!request.url.startsWith('/v1/messages') || request.url.includes('count_tokens')) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ input_tokens: 1 }));
            } else if (request.tools?.some((tool) => tool.name === options.mainTool)) {
                main.push(request);
                reply(res, request, `msg_${String(++replies).padStart(6, '0')}`, options.turn(request));
            } else {
                reply(res, request, 'msg_side', [text('ok')]);
            }
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        requests,
        main,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}

/// The texts of the messages of a request: the prompts, the tool results and the answers, in order
export function messageTexts(request: FakeRequest): string[] {
    const texts: string[] = [];
    for (const message of request.messages ?? []) {
        if (typeof message.content === 'string') {
            texts.push(message.content);
            continue;
        }
        for (const block of message.content) {
            if (block.type === 'text') texts.push(block.text as string);
            else if (block.type === 'tool_result') {
                const content = block.content;
                if (typeof content === 'string') texts.push(content);
                else if (Array.isArray(content)) for (const part of content) if (part.type === 'text') texts.push(part.text as string);
            }
        }
    }
    return texts;
}
