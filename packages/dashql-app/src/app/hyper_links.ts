import * as React from 'react';

import { useConnectionSaver } from '../connections/connection_persistence.js';
import { OPEN_EPHEMERAL_WORKBOOK, OPEN_LINK_WORKBOOK, useRouteContext, useRouterNavigate } from './router.js';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { useOptionalRuntime } from '@akohn/dashql-react/hooks';
import { useEphemeralWorkbook } from '../workbook/workbook_creation.js';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { usePlatformEventListener } from '../host/events/event_listener_provider.js';
import { useLogger } from '../host/logger_provider.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { newConnectionFromParams, type ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import type { HyperLinkEvent } from '../host/events/event_listener.js';
import { getHyperLinkTabState, setHyperLinkToken } from '../connections/hyper/hyper_link_tab.js';

const LOG_CTX = 'hyper_link';

/// The workbook that a link opens: the open workbook if it runs on the connection of the link, otherwise the first
/// workbook on it, null if no full workbook runs on it
export function workbookOnConnection(workbooks: ReadonlyMap<string, WorkbookScripts>, currentWorkbookId: string | null, connectionId: string): string | null {
    const current = currentWorkbookId == null ? undefined : workbooks.get(currentWorkbookId);
    if (current != null && !current.ephemeral && current.connectionIds.includes(connectionId)) return currentWorkbookId;
    for (const [workbookId, scripts] of workbooks) {
        if (!scripts.ephemeral && scripts.connectionIds.includes(connectionId)) return workbookId;
    }
    return null;
}

/// Ask whether a link reuses the connection of an earlier link
function confirmReuse(connection: ConnectionState, endpoint: string): boolean {
    const previous = 'hyper' in connection.params ? connection.params.hyper.endpoint : '';
    return globalThis.confirm(`Use the connection "${connection.label.text}" to ${previous} for the Hyper at ${endpoint}? Cancel creates a new connection.`);
}

/// Follow the Hyper links, of the page and of the native app.
///
/// A link is handled once the app opened the workbook it starts with: the runtime reads its target and binds it to a
/// connection (`bindHyperLink`), a link to another machine is confirmed, the connection takes the token of the link and
/// new workbooks start on it. The app then opens a workbook on the connection, or the greeter on the connection.
export function useHyperLinks(opened: Promise<void>): void {
    const appEvents = usePlatformEventListener();
    const logger = useLogger();
    const saveConnection = useConnectionSaver();
    const runtime = useOptionalRuntime();
    const ephemeralWorkbook = useEphemeralWorkbook();
    const navigate = useRouterNavigate();
    const route = useRouteContext();

    const follow = React.useEffectEvent(async (event: HyperLinkEvent) => {
        if (runtime == null) throw new Error('the Hyper links need a RuntimeProvider');
        const link = runtime.bindHyperLink(event.endpoint, event.token, getHyperLinkTabState().current);
        if (link == null) {
            logger.warn('Ignoring an invalid Hyper link', {}, LOG_CTX);
            return;
        }
        if (link.confirmation != null && !globalThis.confirm(link.confirmation)) return;
        const create = (params: ConnectionParams) => runtime.createConnection(newConnectionFromParams(params, { active: true }));
        let connection: ConnectionState | null = null;
        switch (link.binding.kind) {
            case 'existing':
                connection = runtime.connection(link.binding.connectionId);
                break;
            case 'askToReuse': {
                const reused = runtime.connection(link.binding.connectionId);
                if (reused != null && confirmReuse(reused, link.endpoint)) {
                    await saveConnection(reused.connectionId, link.binding.params as ConnectionParams);
                    connection = runtime.connection(reused.connectionId);
                } else {
                    connection = create(link.binding.create as ConnectionParams);
                }
                break;
            }
            case 'create':
                connection = create(link.binding.params as ConnectionParams);
                break;
        }
        if (connection == null) return;
        setHyperLinkToken(connection.connectionId, link.token);
        const workbooks = runtime.store.all('workbook');
        const workbookId = workbookOnConnection(workbooks, route.workbookId ?? null, connection.connectionId);
        if (workbookId != null) {
            if (workbookId !== route.workbookId) navigate({ type: OPEN_LINK_WORKBOOK, value: workbookId });
            return;
        }
        const greeter = ephemeralWorkbook(connection);
        if (greeter.workbookId !== route.workbookId) navigate({ type: OPEN_EPHEMERAL_WORKBOOK, value: greeter.workbookId });
    });

    React.useEffect(() => appEvents.subscribeHyperLinks(event => {
        logger.info('Received a Hyper link', { endpoint: event.endpoint }, LOG_CTX);
        void opened
            .then(() => follow(event))
            .catch(error => logger.error('Failed to follow a Hyper link', { error: stringifyError(error) }, LOG_CTX));
    }), [appEvents, logger, opened]);
}
