import * as React from 'react';
import { OPEN_EPHEMERAL_SESSION, useRouterNavigate } from '../app/router/router.js';
import { useConnectionAllocator, useConnectionRegistryStore, sessionConnectionFromState } from '../connections/connection_registry.js';
import { ConnectionState } from '../connections/connection_state.js';
import { findEmbeddedConnection, newSessionConnection } from '../connections/embedded_connection.js';
import { getHyperLinkTabState, isHyperLinkParams } from '../connections/hyper/hyper_link.js';
import { useStorageWriter } from '../storage/storage_provider.js';
import { groupSessionManifestWrites, WRITE_SESSION_MANIFEST } from '../storage/storage_writer.js';
import {
    EPHEMERAL_SESSION_NAME,
    freeSessionName,
    isEphemeralSession,
    newScriptConnection,
    scriptConnectionOf,
    SessionScripts,
    SET_PENDING_CONNECTION,
    takenSessionNames,
} from './scripts/session_scripts.js';
import { useSessionScriptsAllocator, useSessionScriptsDispatch, useSessionScriptsRegistryReader } from './scripts/session_scripts_registry.js';
import { createEmptyMetadata } from './scripts/script_types.js';
import { SessionViewMode, useSessionViewMode } from './session_view_mode.js';

/// Create a session whose first script runs on a connection, a session without a name gets a free one
export type SessionCreation = (database: ConnectionState, name?: string) => SessionScripts;

/// Allocate a session without scripts and write its first manifest
function useSessionAllocation(): (database: ConnectionState, name: string, ephemeral: boolean) => SessionScripts {
    const allocateSessionScripts = useSessionScriptsAllocator();
    const storageWriter = useStorageWriter();

    // New sessions start without scripts; the feed greets them with the composer's landing prompt.
    return React.useCallback((database: ConnectionState, name: string, ephemeral: boolean) => {
        const sessionId = crypto.randomUUID();
        const [_sessionId, sessionScripts] = allocateSessionScripts({
            sessionMetadata: { ...createEmptyMetadata(), ...(ephemeral ? { ephemeral } : {}) },
            instance: database.instance,
            sessionId,
            name,
            pendingConnection: scriptConnectionOf(database),
            scripts: {},
            scriptRefs: {},
            scriptOrder: [],
            scriptFocus: { fileName: '' },
            semanticUserFocus: null,
        });
        void storageWriter.write(
            groupSessionManifestWrites(sessionId),
            { type: WRITE_SESSION_MANIFEST, value: [sessionId, [sessionConnectionFromState(database)], { ephemeral }] },
        );
        return sessionScripts;
    }, [allocateSessionScripts, storageWriter]);
}

export function useSessionCreation(): SessionCreation {
    const allocate = useSessionAllocation();
    const readRegistry = useSessionScriptsRegistryReader();
    return React.useCallback((database: ConnectionState, name?: string) => (
        allocate(database, name ?? freeSessionName(takenSessionNames(readRegistry().sessionScriptsMap.values())), false)
    ), [allocate, readRegistry]);
}

/// The ephemeral session of the greeter, created on the connection if there is none.
///
/// There is one at most: the app creates it at launch and again after every promotion. It keeps the connection that the
/// user picked, unless the connection is the one of a Hyper link: a link moves the session to its connection, and a
/// session on the connection of a link that is gone moves back.
export function useEphemeralSession(): (database: ConnectionState) => SessionScripts {
    const allocate = useSessionAllocation();
    const readRegistry = useSessionScriptsRegistryReader();
    const modifySessionScripts = useSessionScriptsDispatch();
    return React.useCallback((database: ConnectionState) => {
        const existing = [...readRegistry().sessionScriptsMap.values()].find(isEphemeralSession);
        if (existing == null) return allocate(database, EPHEMERAL_SESSION_NAME, true);
        const current = newScriptConnection(existing, null);
        if (current?.connectionId !== database.connectionId && (
            getHyperLinkTabState().current === database.connectionId || (current?.params != null && isHyperLinkParams(current.params))
        )) {
            void modifySessionScripts(existing.sessionId, { type: SET_PENDING_CONNECTION, value: scriptConnectionOf(database) });
        }
        return existing;
    }, [allocate, modifySessionScripts, readRegistry]);
}

/// The ephemeral session on the connection that new sessions start on, null before the app set up its connections
export function useEnsureEphemeralSession(): () => SessionScripts | null {
    const registryStore = useConnectionRegistryStore();
    const allocateConnection = useConnectionAllocator();
    const ephemeralSession = useEphemeralSession();
    return React.useCallback(() => {
        const { connections } = registryStore.current;
        const embedded = findEmbeddedConnection(connections.values());
        if (embedded == null) return null;
        return ephemeralSession(newSessionConnection(connections, allocateConnection, embedded.instance));
    }, [allocateConnection, ephemeralSession, registryStore]);
}

/// Open the greeter, the feed of the ephemeral session at the root of the app
export function useOpenGreeter(): () => void {
    const ensureEphemeralSession = useEnsureEphemeralSession();
    const navigate = useRouterNavigate();
    const { setMode } = useSessionViewMode();
    return React.useCallback(() => {
        const session = ensureEphemeralSession();
        if (session == null) return;
        setMode(SessionViewMode.Session);
        navigate({ type: OPEN_EPHEMERAL_SESSION, value: session.sessionId });
    }, [ensureEphemeralSession, navigate, setMode]);
}
