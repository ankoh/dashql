// The probes of the agent integration tests: a server on loopback, a script that tries to reach it, and a hook that
// runs the script and logs what it saw.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';

/// A server on loopback that the probes connect to
export async function startLoopbackTarget() {
    const server = net.createServer(socket => socket.end());
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    return { port: server.address().port, close: () => new Promise(done => server.close(done)) };
}

/// A script that prints `loopback:ok` or `loopback:blocked`
export function writeProbe(dir, port) {
    const probe = join(dir, 'probe.sh');
    writeFileSync(probe, `#!/bin/bash
if (exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null; then echo loopback:ok; else echo loopback:blocked; fi
`);
    chmodSync(probe, 0o755);
    return probe;
}

/// A hook that drains its input and appends `<event> <probe output>` to hooks.log
export function writeHook(dir, probe) {
    const hook = join(dir, 'hook.sh');
    writeFileSync(hook, `#!/bin/bash
cat > /dev/null
echo "$1 $(${probe})" >> ${join(dir, 'hooks.log')}
`);
    chmodSync(hook, 0o755);
    return hook;
}

/// The lines of hooks.log
export function readHookLog(dir) {
    const log = join(dir, 'hooks.log');
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
}

/// Fail before the harness does when the sandbox of Linux is missing its tools
export function requireLinuxSandboxTools(tools) {
    if (process.platform !== 'linux') return;
    for (const tool of tools) {
        if (!['/usr/bin', '/bin', '/usr/local/bin'].some(dir => existsSync(join(dir, tool)))) {
            throw new Error(`the sandbox of the harness on Linux needs ${tool} (apt install bubblewrap socat)`);
        }
    }
}

/// Run a harness, resolve with its stdout once it exits with 0
export function runHarness(binary, args, { cwd, env, timeoutMs = 90_000 }) {
    return new Promise((done, fail) => {
        const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('error', fail);
        child.on('close', code => {
            clearTimeout(timer);
            if (code === 0) done(stdout);
            else fail(new Error(`${binary} exited with ${code}: ${stderr.slice(-2000)}`));
        });
    });
}
