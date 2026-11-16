import type { ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import type { OAuthFlow } from '@ankoh/dashql/platform/oauth_flow';
import type { AgentSessionLogin, AgentSessionLoginAnswer, AgentSessionOAuth } from '@ankoh/dashql/platform/session/agent_session_state';

// The logins that runs of the agent wait for (docs/wip/agent_session.md, "Logins go through the page"): the process of
// `dashql connect` logs in, the tab only opens the authorization page, hands on the callback of the redirect page or
// sends the credentials of its connection. Nothing of it reaches the agent.

/// How the redirect page of the app hands a Salesforce login back to this tab, null without a redirect page in the
/// config of the app
export function agentSessionOAuth(redirect: string | null | undefined, flow: OAuthFlow): AgentSessionOAuth | null {
    if (redirect == null || redirect.length === 0) return null;
    return { redirect, redirectVariant: flow.redirectVariant, redirectCallbackUrl: flow.redirectCallbackUrl, flavor: flow.flavor };
}

/// The answer of the tab to a login of credentials: the user and the password of its Trino connection with basic auth.
/// Null if the tab has no such connection or doesn't let the agent use it.
export function credentialsAnswer(
    login: AgentSessionLogin,
    connections: ReadonlyMap<string, ConnectionState>,
    isAllowed: (connectionId: string) => boolean,
): AgentSessionLoginAnswer | null {
    if (login.kind !== 'credentials' || !isAllowed(login.connectionId)) return null;
    const params = connections.get(login.connectionId)?.params;
    if (params == null || !('trino' in params)) return null;
    const auth = params.trino.auth;
    if (auth?.authType === 'AUTH_OAUTH') return null;
    return { basic: { username: auth?.basic?.username ?? '', secret: auth?.basic?.secret ?? '' } };
}
