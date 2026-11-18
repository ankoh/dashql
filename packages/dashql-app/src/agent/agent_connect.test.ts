import { describe, expect, it } from 'vitest';

import { parseAgentSessionTarget } from '@akohn/dashql/platform/session/agent_session_client';

import { DASHQL_CLI_VERSION } from '../globals.js';
import { agentConnectCommand, DASHQL_CLI_COMMAND, newAgentConnectTarget } from './agent_connect.js';

describe('agent connect', () => {
    it('picks a dynamic loopback port and a secret that a link would take too', () => {
        for (let i = 0; i < 100; ++i) {
            const target = newAgentConnectTarget();
            const port = Number(new URL(target.endpoint).port);
            expect(port).toBeGreaterThanOrEqual(49152);
            expect(port).toBeLessThanOrEqual(65535);
            expect(target.token).toMatch(/^[\w-]{24}$/);
            expect(parseAgentSessionTarget(target.endpoint, target.token)).toEqual(target);
        }
        expect(newAgentConnectTarget(bytes => bytes.fill(0xff))).toEqual({ endpoint: 'http://127.0.0.1:65535', token: '________________________' });
        expect(newAgentConnectTarget(bytes => bytes.fill(0))).toEqual({ endpoint: 'http://127.0.0.1:49152', token: 'AAAAAAAAAAAAAAAAAAAAAAAA' });
    });

    it('runs the command line tool of its own build from the public registry', () => {
        // A build pins the npm version of its commit, only the dev server takes the latest
        expect(DASHQL_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+(-dev\.\d+\.g[0-9a-f]+)?$/);
        expect(DASHQL_CLI_COMMAND).toBe(`npx -y --registry=https://registry.npmjs.org/ --min-release-age=0 @akohn/dashql-cli@${DASHQL_CLI_VERSION}`);
    });

    it('writes the line of dashql connect', () => {
        expect(agentConnectCommand('codex', { endpoint: 'http://127.0.0.1:51234', token: 'k3x9' }))
            .toBe(`${DASHQL_CLI_COMMAND} connect --launch codex --port 51234 --secret k3x9`);
    });
});
