// The probes of the agent integration tests: a server on loopback, a script that tries to reach it, and a hook that
// runs the script and logs what it saw.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join, resolve } from 'node:path';

/// The Node binary itself: in a js_test of Bazel, process.execPath is a wrapper that needs the environment of the test,
/// which a harness doesn't pass to its hooks
const NODE = process.env.JS_BINARY__NODE_BINARY ? resolve(process.env.JS_BINARY__NODE_BINARY) : process.execPath;

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

/// A server on loopback that a SessionStart hook starts for the session, like the server of a live view. It records
/// the lines that the hooks send it in session.events and writes its port to session.port.
function writeSessionServer(dir) {
    const server = join(dir, 'session_server.mjs');
    writeFileSync(server, `import net from 'node:net';
import { appendFileSync, writeFileSync } from 'node:fs';
const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    socket.on('data', data => appendFileSync(${JSON.stringify(join(dir, 'session.events'))}, data));
});
server.listen(0, '127.0.0.1', () => {
    appendFileSync(${JSON.stringify(join(dir, 'session.events'))}, 'started\\n');
    writeFileSync(${JSON.stringify(join(dir, 'session.pid'))}, String(process.pid));
    writeFileSync(${JSON.stringify(join(dir, 'session.port'))}, String(server.address().port));
});
`);
    return server;
}

/// A hook that starts the session server on SessionStart and sends every other event to it
export function writeSessionHook(dir) {
    const server = writeSessionServer(dir);
    const port = join(dir, 'session.port');
    const hook = join(dir, 'session_hook.sh');
    writeFileSync(hook, `#!/bin/bash
cat > /dev/null
if [ "$1" = SessionStart ]; then
    # The harness waits for the output of a hook, the server must not hold it
    nohup ${JSON.stringify(NODE)} ${JSON.stringify(server)} > ${JSON.stringify(join(dir, 'session.log'))} 2>&1 &
    for i in $(seq 50); do [ -s ${JSON.stringify(port)} ] && break; sleep 0.1; done
fi
if [ -s ${JSON.stringify(port)} ]; then
    exec 3<>/dev/tcp/127.0.0.1/$(cat ${JSON.stringify(port)}) && echo "$1" >&3
fi
`);
    chmodSync(hook, 0o755);
    return hook;
}

/// A script that tries to reach the session server, prints `loopback:ok` or `loopback:blocked`
export function writeSessionProbe(dir) {
    const probe = join(dir, 'session_probe.sh');
    writeFileSync(probe, `#!/bin/bash
if (exec 3<>/dev/tcp/127.0.0.1/$(cat ${JSON.stringify(join(dir, 'session.port'))})) 2>/dev/null; then echo loopback:ok; else echo loopback:blocked; fi
`);
    chmodSync(probe, 0o755);
    return probe;
}

/// The events that reached the session server and its output, it stops afterwards
export function stopSessionServer(dir) {
    const pid = join(dir, 'session.pid');
    if (existsSync(pid)) {
        try { process.kill(Number(readFileSync(pid, 'utf8'))); } catch { /* gone */ }
    }
    const events = join(dir, 'session.events');
    const log = join(dir, 'session.log');
    return {
        events: existsSync(events) ? readFileSync(events, 'utf8').trim().split('\n') : [],
        log: existsSync(log) ? readFileSync(log, 'utf8') : '',
    };
}

/// A SQL file with a parse error for `dashql lint`
export function writeBrokenScript(dir) {
    const script = join(dir, 'broken.sql');
    writeFileSync(script, 'select * from;\n');
    return script;
}
