import { describe, expect, it } from 'vitest';

import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { OAuthFlow } from '@akohn/dashql/platform/oauth_flow';
import type { AgentSessionLogin } from '@akohn/dashql/platform/session/agent_session_state';

import { agentSessionOAuth, credentialsAnswer } from './agent_session_logins.js';

/// Connections with only the params that the answers read
function connections(params: Record<string, unknown>): ReadonlyMap<string, ConnectionState> {
    return new Map(Object.entries(params).map(([id, value]) => [id, { connectionId: id, params: value } as unknown as ConnectionState]));
}

const LOGIN: AgentSessionLogin = { connectionId: 'c1', name: 'Trino prod', kind: 'credentials', url: '' };

describe('the logins of the agent in the tab', () => {
    it('sends the user and the password of a Trino connection with basic auth that the agent may use', () => {
        const tab = connections({
            c1: { trino: { endpoint: 'https://trino.example', auth: { authType: 'AUTH_BASIC', basic: { username: 'ann', secret: 'pw' } } } },
            c2: { trino: { endpoint: 'https://trino.example' } },
            c3: { trino: { auth: { authType: 'AUTH_OAUTH' } } },
            c4: { salesforce: { instanceUrl: 'https://org.my.salesforce.com' } },
        });
        expect(credentialsAnswer(LOGIN, tab, () => true)).toEqual({ basic: { username: 'ann', secret: 'pw' } });
        // A Trino without auth answers with an empty user
        expect(credentialsAnswer({ ...LOGIN, connectionId: 'c2' }, tab, () => true)).toEqual({ basic: { username: '', secret: '' } });
        // Nothing for a connection that the agent may not use, that the tab doesn't have or that has no password
        expect(credentialsAnswer(LOGIN, tab, id => id !== 'c1')).toBeNull();
        expect(credentialsAnswer({ ...LOGIN, connectionId: 'c9' }, tab, () => true)).toBeNull();
        expect(credentialsAnswer({ ...LOGIN, connectionId: 'c3' }, tab, () => true)).toBeNull();
        expect(credentialsAnswer({ ...LOGIN, connectionId: 'c4' }, tab, () => true)).toBeNull();
        // The user opens the other logins
        expect(credentialsAnswer({ ...LOGIN, kind: 'redirect' }, tab, () => true)).toBeNull();
    });

    it('tells the session how the redirect page hands a Salesforce login back to the tab', () => {
        const flow = { redirectVariant: 'WEB_OPENER_FLOW', redirectCallbackUrl: 'http://localhost:9002/oauth.html', flavor: 'dev' } as OAuthFlow;
        expect(agentSessionOAuth('https://dashql.app/oauth.html', flow)).toEqual({
            redirect: 'https://dashql.app/oauth.html',
            redirectVariant: 'WEB_OPENER_FLOW',
            redirectCallbackUrl: 'http://localhost:9002/oauth.html',
            flavor: 'dev',
        });
        expect(agentSessionOAuth(null, flow)).toBeNull();
        expect(agentSessionOAuth('', flow)).toBeNull();
    });
});
