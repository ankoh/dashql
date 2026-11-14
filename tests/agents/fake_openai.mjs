// A fake of the Responses API of OpenAI for agent harnesses like Codex. A test scripts the turns of the conversation,
// each turn is a list of output items. Records every request.
import http from 'node:http';

/// A message of the assistant
export const message = text => ({
    type: 'message',
    id: `msg_${Math.random().toString(36).slice(2, 10)}`,
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
});

/// A call of a tool, e.g. `exec_command` with `{ cmd }`
export const functionCall = (name, args, callId = `call_${Math.random().toString(36).slice(2, 10)}`) => ({
    type: 'function_call',
    id: `fc_${callId}`,
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
    status: 'completed',
});

/// The outputs of tool calls that a request sends back
export function functionCallOutputs(request) {
    return (request.input ?? []).filter(item => item.type === 'function_call_output');
}

const USAGE = {
    input_tokens: 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 2,
};

/// Start the fake. `turn(request, index)` returns the output items of the next response.
export async function startFakeOpenAI({ turn }) {
    const requests = [];
    let turns = 0;
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            let request = {};
            try { request = JSON.parse(body); } catch { /* not JSON */ }
            requests.push({ url: req.url, ...request });
            if (!req.url.endsWith('/responses')) {
                res.writeHead(404);
                res.end();
                return;
            }
            const id = `resp_${turns}`;
            const items = turn(request, turns++);
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
            const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
            send('response.created', { response: { id, status: 'in_progress', output: [] } });
            items.forEach((item, index) => {
                send('response.output_item.added', { output_index: index, item });
                send('response.output_item.done', { output_index: index, item });
            });
            send('response.completed', { response: { id, status: 'completed', output: items, usage: USAGE } });
            res.end();
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise(resolve => server.close(resolve)),
    };
}
