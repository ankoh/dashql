import * as React from 'react';
import type * as core from '@akohn/dashql';

import { createRuntime, type ChannelConnector } from '@akohn/dashql/runtime/runtime';
import { RuntimeContextProvider, useOwnedRuntime } from '@akohn/dashql-react/hooks';

import { useLogger } from './logger_provider.js';
import { useEmbeddedDatabaseSetup } from './embedded_database_provider.js';
import { useOptionalHttpClient } from './http/http_client_provider.js';
import { FRAME_UPDATE_SCHEDULER } from '../utils/store_hooks.js';
import { useDashQLCore } from './core_provider.js';

/// A runtime without the storage of the app, e.g. of the shell of Hyper or of a tool, on the embedded database and the
/// HTTP client of the providers above it, without an HTTP client for a page that sends no requests. It is created once
/// the core of the provider above is there, without one the core that the package instantiated already, and it goes
/// with the component. `channels` connects the channels of its connections, e.g. the embedded Hyper of the shell.
export function StandaloneRuntime(props: { channels?: ChannelConnector; fallback?: React.ReactNode; children?: React.ReactNode }) {
    const core = useDashQLCore();
    // The fallback shows while the core loads
    if (core == null) return props.fallback ?? null;
    return <StandaloneRuntimeOf core={core} channels={props.channels}>{props.children}</StandaloneRuntimeOf>;
}

function StandaloneRuntimeOf(props: { core: core.DashQL; channels?: ChannelConnector; children?: React.ReactNode }) {
    const logger = useLogger();
    const http = useOptionalHttpClient();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const runtime = useOwnedRuntime(() => createRuntime({
        logger,
        scheduler: FRAME_UPDATE_SCHEDULER,
        core: props.core,
        http,
        computeDatabase: setupEmbeddedDatabase == null ? null : () => setupEmbeddedDatabase('compute'),
        channels: props.channels,
    }));
    return <RuntimeContextProvider value={runtime}>{props.children}</RuntimeContextProvider>;
}
