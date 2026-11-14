// A fake of the Messages API of Anthropic for agent harnesses like Claude Code. A test scripts the turns of the main
// conversation, every other request (titles, summaries, token counts) gets a short answer. Records every request.
import http from 'node:http';

/// A text block of a scripted turn
export const text = value => ({ type: 'text', text: value });
/// A tool call of a scripted turn
export const toolUse = (name, input, id = `toolu_${Math.random().toString(36).slice(2, 10)}`) => ({ type: 'tool_use', id, name, input });

/// The tool results of the last message of a request
export function toolResults(request) {
    const last = request.messages?.at(-1);
    return Array.isArray(last?.content) ? last.content.filter(block => block.type === 'tool_result') : [];
}

function events(id, content, stopReason) {
    const out = [['message_start', { message: { id, type: 'message', role: 'assistant', model: 'fake', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } }]];
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
    out.push(['message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } }]);
    out.push(['message_stop', {}]);
    return out;
}

function reply(res, request, id, content) {
    const stopReason = content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn';
    if (request.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        for (const [type, data] of events(id, content, stopReason)) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        res.end();
    } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: 'fake', content, stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    }
}

/// Start the fake. `turn(request, index)` returns the content blocks of the next turn of the main conversation, the
/// one whose request offers the tool `mainTool`.
export async function startFakeAnthropic({ turn, mainTool = 'Bash' }) {
    const requests = [];
    let turns = 0;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            let request = {};
            try { request = JSON.parse(body); } catch { /* not JSON */ }
            requests.push({ url: req.url, ...request });
            if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ input_tokens: 1 }));
            } else if (request.tools?.some(tool => tool.name === mainTool)) {
                reply(res, request, `msg_${turns}`, turn(request, turns++));
            } else {
                reply(res, request, 'msg_side', [text('ok')]);
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise(resolve => server.close(resolve)),
    };
}
