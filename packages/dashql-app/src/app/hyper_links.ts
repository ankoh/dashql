import * as React from 'react';

import { useConnectionAllocator, useConnectionRegistryStore } from '../connections/connection_registry.js';
import { useConnectionSaver } from '../connections/connection_persistence.js';
import { connectionLabel } from '@ankoh/dashql-sdk/connections/connection_label';
import { useDashQLCoreSetup } from '../runtime/core_provider.js';
import { OPEN_EPHEMERAL_WORKBOOK, OPEN_LINK_WORKBOOK, useRouteContext, useRouterNavigate } from './router/router.js';
import { isEphemeralWorkbook, workbookConnectionIds, type WorkbookScripts } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import { useWorkbookScriptsRegistryReader } from '../workbook/scripts/workbook_scripts_registry.js';
import { useEphemeralWorkbook } from '../workbook/workbook_creation.js';
import type { ConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import { usePlatformEventListener } from '../platform/events/event_listener_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { stringifyError } from '@ankoh/dashql-sdk/platform/logger/logger';
import { bindHyperLink, confirmHyperLink, getHyperLinkTabState, isHyperLinkParams, setHyperLinkToken, type HyperLinkTarget } from '../connections/hyper/hyper_link.js';

const LOG_CTX = 'hyper_link';

/// The workbook that a link opens: the open workbook if it runs on the connection of the link, otherwise the first
/// workbook on it, null if no full workbook runs on it
export function workbookOnConnection(workbooks: Map<string, WorkbookScripts>, currentWorkbookId: string | null, connectionId: string): string | null {
    const current = currentWorkbookId == null ? undefined : workbooks.get(currentWorkbookId);
    if (current != null && !isEphemeralWorkbook(current) && workbookConnectionIds(current).includes(connectionId)) return currentWorkbookId;
    for (const [workbookId, scripts] of workbooks) {
        if (!isEphemeralWorkbook(scripts) && workbookConnectionIds(scripts).includes(connectionId)) return workbookId;
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
/// A link is handled once the app opened the workbook it starts with: a link to another machine is confirmed, the link is bound
/// to a connection (see `bindHyperLink`), the connection takes the token of the link and new workbooks start on it.
/// The app then opens a workbook on the connection, or the greeter on the connection.
export function useHyperLinks(opened: Promise<void>): void {
    const appEvents = usePlatformEventListener();
    const logger = useLogger();
    const setupCore = useDashQLCoreSetup();
    const registryStore = useConnectionRegistryStore();
    const allocate = useConnectionAllocator();
    const saveConnection = useConnectionSaver();
    const readWorkbooks = useWorkbookScriptsRegistryReader();
    const ephemeralWorkbook = useEphemeralWorkbook();
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
        const workbooks = readWorkbooks().workbookScriptsMap;
        const workbookId = workbookOnConnection(workbooks, route.workbookId ?? null, binding.connection.connectionId);
        if (workbookId != null) {
            if (workbookId !== route.workbookId) navigate({ type: OPEN_LINK_WORKBOOK, value: workbookId });
            return;
        }
        const greeter = ephemeralWorkbook(binding.connection);
        if (greeter.workbookId !== route.workbookId) navigate({ type: OPEN_EPHEMERAL_WORKBOOK, value: greeter.workbookId });
    });

    React.useEffect(() => appEvents.subscribeHyperLinks(target => {
        logger.info('Received a Hyper link', { endpoint: target.endpoint }, LOG_CTX);
        void opened
            .then(() => follow(target))
            .catch(error => logger.error('Failed to follow a Hyper link', { error: stringifyError(error) }, LOG_CTX));
    }), [appEvents, logger, opened]);
}
