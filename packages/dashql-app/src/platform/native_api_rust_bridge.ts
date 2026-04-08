import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';

type BridgeRequest = {
    request_id: number;
    method: string;
    url: string;
    headers: Array<[string, string]>;
    body: number[];
};

type BridgeResponse = {
    request_id: number;
    status: number;
    status_text: string;
    headers: Array<[string, string]>;
    body: number[];
};

function getHelperPath(): string {
    const helperPath = process.env.DASHQL_NATIVE_IPC_BRIDGE;
    if (helperPath == null || helperPath === '') {
        throw new Error('DASHQL_NATIVE_IPC_BRIDGE is not configured');
    }
    if (path.isAbsolute(helperPath)) {
        return helperPath;
    }
    const testSrcDir = process.env.TEST_SRCDIR;
    const testWorkspace = process.env.TEST_WORKSPACE;
    if (testSrcDir != null && testSrcDir !== '' && testWorkspace != null && testWorkspace !== '') {
        return path.join(testSrcDir, testWorkspace, helperPath);
    }
    return helperPath;
}

async function readBody(req: Request): Promise<number[]> {
    const body = await req.arrayBuffer();
    return Array.from(new Uint8Array(body));
}

export class NativeAPIRustBridge {
    helperPath: string;
    childProcess: ChildProcessWithoutNullStreams | null;
    nextRequestId: number;
    pending: Map<number, { resolve: (response: BridgeResponse) => void; reject: (error: Error) => void }>;
    stdoutBuffer: string;

    constructor(helperPath: string = getHelperPath()) {
        this.helperPath = helperPath;
        this.childProcess = null;
        this.nextRequestId = 1;
        this.pending = new Map();
        this.stdoutBuffer = '';
    }

    protected ensureProcess(): ChildProcessWithoutNullStreams {
        if (this.childProcess != null) {
            return this.childProcess;
        }
        const child = spawn(this.helperPath, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const events = child as ChildProcessWithoutNullStreams & EventEmitter;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            this.stdoutBuffer += chunk;
            this.drainStdout();
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (_chunk: string) => {
        });
        events.on('exit', (code, signal) => {
            const error = new Error(`native IPC bridge exited unexpectedly: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
            const pending = Array.from(this.pending.values());
            this.pending.clear();
            this.childProcess = null;
            for (const waiter of pending) {
                waiter.reject(error);
            }
        });
        events.on('error', (error) => {
            const pending = Array.from(this.pending.values());
            this.pending.clear();
            this.childProcess = null;
            for (const waiter of pending) {
                waiter.reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
        this.childProcess = child;
        return child;
    }

    protected drainStdout(): void {
        while (true) {
            const newline = this.stdoutBuffer.indexOf('\n');
            if (newline < 0) {
                return;
            }
            const line = this.stdoutBuffer.slice(0, newline);
            this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
            if (line.length === 0) {
                continue;
            }
            const parsed = JSON.parse(line) as BridgeResponse & { request_id: number };
            const waiter = this.pending.get(parsed.request_id);
            if (waiter == null) {
                continue;
            }
            this.pending.delete(parsed.request_id);
            waiter.resolve(parsed);
        }
    }

    async processRequest(req: Request): Promise<Response> {
        if (!req.url.startsWith('dashql-native://')) {
            throw new Error(`unsupported URL: ${req.url}`);
        }
        const requestId = this.nextRequestId++;
        const payload: BridgeRequest = {
            request_id: requestId,
            method: req.method,
            url: req.url,
            headers: Array.from(req.headers.entries()),
            body: await readBody(req),
        };
        const child = this.ensureProcess();
        const response = await new Promise<BridgeResponse>((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            child.stdin.write(JSON.stringify(payload));
            child.stdin.write('\n');
        });
        return new Response(new Uint8Array(response.body), {
            status: response.status,
            statusText: response.status_text,
            headers: new Headers(response.headers),
        });
    }

    async process(req: Request): Promise<Response> {
        return await this.processRequest(req);
    }

    close(): void {
        if (this.childProcess != null) {
            this.childProcess.kill();
            this.childProcess = null;
        }
        this.pending.clear();
        this.stdoutBuffer = '';
    }
}
