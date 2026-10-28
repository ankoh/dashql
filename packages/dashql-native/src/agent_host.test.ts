import {randomBytes} from "node:crypto";
import {mkdtempSync, writeFileSync} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {AgentHost, type AgentHostSnapshot, type AgentHostState, agentHome} from "./agent_host.js";

/// The dashql binary of //packages/dashql-cli:dashql, a runfiles path
function dashqlBinary(): string {
    const rootpath = process.env.DASHQL_CLI;
    if (!rootpath) throw new Error("DASHQL_CLI is not set, run the test with bazel");
    const runfiles = process.env.JS_BINARY__RUNFILES;
    return runfiles ? path.join(runfiles, "_main", rootpath) : path.resolve("../..", rootpath);
}

async function freePort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const {port} = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
}

/// A home with a configuration and the environment of a server that uses it
async function environment(): Promise<NodeJS.ProcessEnv> {
    const home = mkdtempSync(path.join(os.tmpdir(), "dashql-agent-host-"));
    const port = await freePort();
    writeFileSync(path.join(home, "config.json"), JSON.stringify({token: randomBytes(24).toString("hex"), port}));
    return {PATH: "/usr/bin:/bin", HOME: home, DASHQL_AGENT_HOME: home, TMPDIR: os.tmpdir()};
}

function waitFor(host: AgentHost, matches: (snapshot: AgentHostSnapshot) => boolean, timeoutMs = 10000): Promise<AgentHostSnapshot> {
    if (matches(host.snapshot)) return Promise.resolve(host.snapshot);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            stop();
            reject(new Error(`timed out in state ${JSON.stringify(host.snapshot)}`));
        }, timeoutMs);
        const stop = host.onChange((snapshot) => {
            if (!matches(snapshot)) return;
            clearTimeout(timer);
            stop();
            resolve(snapshot);
        });
    });
}

const inState = (state: AgentHostState) => (snapshot: AgentHostSnapshot) => snapshot.state === state;

/// Connect to the WebSocket of the server as DashQL.app does and announce a session
async function connectPage(port: number, origin: string): Promise<net.Socket> {
    const socket = net.connect(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => socket.once("connect", resolve).once("error", reject));
    socket.write(
        `GET /v1/ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\n` +
            "Upgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
    const head = await new Promise<string>((resolve) => {
        let received = "";
        const onData = (chunk: Buffer) => {
            received += chunk.toString("latin1");
            if (!received.includes("\r\n\r\n")) return;
            socket.off("data", onData);
            resolve(received);
        };
        socket.on("data", onData);
    });
    expect(head.split(" ")[1]).toBe("101");
    const message = {
        id: "p1",
        method: "client/sessions",
        params: {protocol: 2, client: "desktop", sessions: [{id: "s1", name: "Orders"}], focused: "s1"},
    };
    socket.write(maskedTextFrame(JSON.stringify(message)));
    return socket;
}

/// A text frame from a client, which RFC 6455 requires to be masked
function maskedTextFrame(text: string): Buffer {
    const payload = Buffer.from(text, "utf8");
    const length = payload.length < 126 ? Buffer.from([0x80 | payload.length]) : Buffer.from([0x80 | 126, payload.length >> 8, payload.length & 0xff]);
    const mask = randomBytes(4);
    const masked = payload.map((byte, i) => byte ^ mask[i % 4]!);
    return Buffer.concat([Buffer.from([0x81]), length, mask, masked]);
}

const options = {binary: "", dev: false, pollIntervalMs: 100, restartDelaysMs: [100]};

describe("AgentHost", () => {
    const hosts: AgentHost[] = [];
    afterEach(async () => {
        await Promise.all(hosts.splice(0).map((host) => host.stop()));
    });
    function host(env: NodeJS.ProcessEnv, dev = false): AgentHost {
        const created = new AgentHost({...options, binary: dashqlBinary(), env, dev});
        hosts.push(created);
        return created;
    }

    it("finds the home of the server", () => {
        expect(agentHome({HOME: "/home/u"}, false)).toBe("/home/u/.dashql/agent");
        expect(agentHome({HOME: "/home/u"}, true)).toBe("/home/u/.dashql/agent-dev");
        expect(agentHome({HOME: "/home/u", DASHQL_AGENT_HOME: "/tmp/a"}, true)).toBe("/tmp/a");
    });

    it("runs the server and follows its clients", async () => {
        const env = await environment();
        const agent = host(env);
        agent.start();
        const running = await waitFor(agent, inState("running"));
        expect(running.status?.clients).toEqual([]);
        expect(running.status?.turns).toEqual([]);

        const page = await connectPage(running.status!.port, "app://bundle");
        const connected = await waitFor(agent, (s) => s.status?.clients.length === 1);
        expect(connected.status?.clients[0]).toMatchObject({kind: "desktop", origin: "app://bundle", sessions: [{id: "s1", name: "Orders"}], focused: "s1"});
        page.destroy();
        await waitFor(agent, (s) => s.status?.clients.length === 0);
    });

    it("starts the server again when it crashes", async () => {
        const agent = host(await environment());
        agent.start();
        await waitFor(agent, inState("running"));
        const pid = agent.pid!;
        process.kill(pid, "SIGKILL");
        const failed = await waitFor(agent, inState("failed"));
        expect(failed.error).toBe("The agent server was killed with SIGKILL");
        await waitFor(agent, inState("running"));
        expect(agent.pid).not.toBe(pid);
    });

    it("follows a server that another DashQL runs and takes over when it stops", async () => {
        const env = await environment();
        const first = host(env);
        first.start();
        await waitFor(first, inState("running"));
        const second = host(env);
        second.start();
        const external = await waitFor(second, inState("external"));
        expect(external.status?.clients).toEqual([]);
        expect(second.pid).toBeNull();

        await first.stop();
        await waitFor(second, inState("running"));
        expect(second.pid).not.toBeNull();
    });

    it("reports a port that something else holds", async () => {
        const env = await environment();
        const blocker = net.createServer();
        const port = await freePort();
        await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));
        try {
            const agent = host({...env, DASHQL_AGENT_PORT: String(port)});
            agent.start();
            const failed = await waitFor(agent, inState("failed"));
            expect(failed.error).toMatch(`Port ${port} is taken`);
        } finally {
            blocker.close();
        }
    });

    it("reports a binary that does not exist", async () => {
        const agent = new AgentHost({...options, binary: "/nonexistent/dashql", env: await environment()});
        hosts.push(agent);
        agent.start();
        const failed = await waitFor(agent, inState("failed"));
        expect(failed.error).toMatch("ENOENT");
    });

    it("stops the server", async () => {
        const agent = host(await environment(), true);
        agent.start();
        const running = await waitFor(agent, inState("running"));
        const pid = agent.pid!;
        await agent.stop();
        expect(agent.snapshot).toEqual({state: "stopped", status: null, error: null});
        expect(() => process.kill(pid, 0)).toThrow();
        // The port is free again
        const blocker = net.createServer();
        await new Promise<void>((resolve, reject) => blocker.once("error", reject).listen(running.status!.port, "127.0.0.1", resolve));
        blocker.close();
    });
});
