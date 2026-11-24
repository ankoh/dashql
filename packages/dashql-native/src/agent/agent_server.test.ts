import {request} from "node:http";

import {afterEach, describe, expect, test} from "vitest";

import {AgentServer, MAX_CALL_BYTES, parseCall, type AgentCallHandler, type AgentCallPart, type AgentCallRequest} from "./agent_server.js";

let server: AgentServer | null = null;

afterEach(async () => {
    await server?.close();
    server = null;
});

/// A handler that answers every call of the workbook w1 with its command, and holds the call of `wait`
function handler(calls: AgentCallRequest[], aborted: string[] = []): AgentCallHandler {
    return {
        accepts: workbookId => workbookId === "w1",
        call: (call, write, signal) => {
            calls.push(call);
            if (call.command === "wait") {
                signal.addEventListener("abort", () => aborted.push(call.command));
                return;
            }
            write({out: `${call.command} ${JSON.stringify(call.args)}\n`});
            write({err: "a warning\n"});
            write({exit: call.command === "fail" ? 1 : 0});
        },
    };
}

async function post(body: unknown, token = server!.token): Promise<{status: number; text: string}> {
    const response = await fetch(`${server!.url}/v1/call`, {
        method: "POST",
        headers: {"authorization": `Bearer ${token}`, "content-type": "application/json"},
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return {status: response.status, text: await response.text()};
}

describe("the agent server", () => {
    test("answers a call with the lines of the page", async () => {
        const calls: AgentCallRequest[] = [];
        server = await AgentServer.start(handler(calls));
        expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(server.token).toMatch(/^[0-9a-f]{64}$/);
        const answer = await post({workbookId: "w1", command: "edit", args: {script: "orders"}, input: "select 1"});
        expect(answer.status).toBe(200);
        expect(answer.text.trim().split("\n").map(line => JSON.parse(line) as AgentCallPart)).toEqual([
            {out: "edit {\"script\":\"orders\"}\n"}, {err: "a warning\n"}, {exit: 0},
        ]);
        expect(calls).toEqual([{workbookId: "w1", command: "edit", args: {script: "orders"}, input: "select 1"}]);
        expect((await post({workbookId: "w1", command: "fail"})).text).toContain("{\"exit\":1}");
    });

    test("refuses a wrong token, other routes, malformed and large calls and workbooks without a question", async () => {
        server = await AgentServer.start(handler([]));
        expect((await post({workbookId: "w1", command: "scripts"}, "wrong")).status).toBe(401);
        expect((await fetch(`${server.url}/v1/state`, {headers: {"authorization": `Bearer ${server.token}`}})).status).toBe(404);
        expect((await post("not json")).status).toBe(400);
        expect((await post({workbookId: "w1", command: "Bad Command"})).status).toBe(400);
        expect((await post({workbookId: "w1", command: "edit", input: 3})).status).toBe(400);
        const other = await post({workbookId: "w2", command: "scripts"});
        expect(other).toEqual({status: 409, text: "DashQL runs no question on this workbook"});
        expect((await post({workbookId: "w1", command: "edit", input: "x".repeat(MAX_CALL_BYTES + 1)})).status).toBe(413);
    });

    test("runs one call at a time per workbook and aborts a call whose command went away", async () => {
        const aborted: string[] = [];
        server = await AgentServer.start(handler([], aborted));
        const body = JSON.stringify({workbookId: "w1", command: "wait"});
        const waiting = request(`${server.url}/v1/call`, {method: "POST", headers: {"authorization": `Bearer ${server.token}`, "content-type": "application/json"}});
        const responded = new Promise<void>(resolve => waiting.on("response", () => resolve()));
        waiting.on("error", () => {});
        waiting.end(body);
        await responded;
        const busy = await post({workbookId: "w1", command: "scripts"});
        expect(busy.status).toBe(409);
        expect(busy.text).toMatch(/one at a time/);
        waiting.destroy();
        for (let i = 0; i < 50 && aborted.length === 0; ++i) await new Promise(resolve => setTimeout(resolve, 20));
        expect(aborted).toEqual(["wait"]);
        expect((await post({workbookId: "w1", command: "scripts"})).status).toBe(200);
    });
});

test("a call needs a workbook and a command, its arguments and input are optional", () => {
    expect(parseCall(JSON.stringify({workbookId: "w", command: "scripts"}))).toEqual({workbookId: "w", command: "scripts", args: {}, input: null});
    expect(parseCall(JSON.stringify({command: "scripts"}))).toBe("The call names no workbook");
    expect(parseCall(JSON.stringify({workbookId: "w", command: "x", args: []}))).toBe("The arguments of the call are no object");
});
