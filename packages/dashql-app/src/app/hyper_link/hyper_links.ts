import * as React from 'react';

import { useConnectionAllocator, useConnectionRegistryStore } from '../connections/connection_registry.js';
import { useConnectionSaver } from '../connections/connection_persistence.js';
import { connectionLabel } from '../connections/ui/connection_label.js';
import { useDashQLCoreSetup } from '../providers/core_provider.js';
import { OPEN_LINK_SESSION, useRouteContext, useRouterNavigate } from '../router/router.js';
import { sessionConnectionIds, type SessionScripts } from '../session/scripts/session_scripts.js';
import { useSessionScriptsRegistryReader } from '../session/scripts/session_scripts_registry.js';
import { useSessionCreation } from '../session/session_creation.js';
import type { ConnectionState } from '../connections/connection_state.js';
import { usePlatformEventListener } from '../../platform/events/event_listener_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { bindHyperLink, confirmHyperLink, getHyperLinkTabState, isHyperLinkParams, setHyperLinkToken, type HyperLinkTarget } from './hyper_link.js';

const LOG_CTX = 'hyper_link';

/// The session that a link opens: the open session if it runs on the connection of the link, otherwise the first
/// session on it, null if a new one is needed
export function sessionOnConnection(sessions: Map<string, SessionScripts>, currentSessionId: string | null, connectionId: string): string | null {
    const current = currentSessionId == null ? undefined : sessions.get(currentSessionId);
    if (current != null && sessionConnectionIds(current).includes(connectionId)) return currentSessionId;
    for (const [sessionId, scripts] of sessions) {
        if (sessionConnectionIds(scripts).includes(connectionId)) return sessionId;
    }
    return null;
}

/// Ask whether a link reuses the connection of an earlier link
function confirmReuse(connection: ConnectionState, target: HyperLinkTarget): boolean {
    const endpoint = 'hyper' in connection.params ? connection.params.hyper.endpoint : '';
    return globalThis.confirm(`Use the connection "${connectionLabel(connection)}" to ${endpoint} for the Hyper at ${target.endpoint}? Cancel creates a new connection.`);
}

/// Follow the Hyper links, of the page and of the native app.
///
/// A link is handled once the app opened its first session: a link to another machine is confirmed, the link is bound
/// to a connection (see `bindHyperLink`), the connection takes the token of the link and new sessions start on it.
/// The app then opens a session on the connection, or creates one.
export function useHyperLinks(opened: Promise<void>): void {
    const appEvents = usePlatformEventListener();
    const logger = useLogger();
    const setupCore = useDashQLCoreSetup();
    const registryStore = useConnectionRegistryStore();
    const allocate = useConnectionAllocator();
    const saveConnection = useConnectionSaver();
    const readSessions = useSessionScriptsRegistryReader();
    const createSession = useSessionCreation();
    const navigate = useRouterNavigate();
    const route = useRouteContext();

    const follow = React.useEffectEvent(async (target: HyperLinkTarget) => {
        const dql = await setupCore(LOG_CTX);
        const connections = [...registryStore.current.connections.values()];
        const known = connections.some(connection => isHyperLinkParams(connection.params)
            && 'hyper' in connection.params && connection.params.hyper.endpoint === target.endpoint);
        if (!known && !confirmHyperLink(target)) return;
        const binding = bindHyperLink(target, connections, allocate, dql, getHyperLinkTabState().current,
            connection => confirmReuse(connection, target));
        if (binding.params != null) await saveConnection(binding.connection.connectionId, binding.params);
        setHyperLinkToken(binding.connection.connectionId, target.token);
        const sessions = readSessions().sessionScriptsMap;
        const sessionId = sessionOnConnection(sessions, route.sessionId ?? null, binding.connection.connectionId)
            ?? createSession(binding.connection).sessionId;
        if (sessionId !== route.sessionId) navigate({ type: OPEN_LINK_SESSION, value: sessionId });
    });

    React.useEffect(() => appEvents.subscribeHyperLinks(target => {
        logger.info('Received a Hyper link', { endpoint: target.endpoint }, LOG_CTX);
        void opened
            .then(() => follow(target))
            .catch(error => logger.error('Failed to follow a Hyper link', { error: stringifyError(error) }, LOG_CTX));
    }), [appEvents, logger, opened]);
}
