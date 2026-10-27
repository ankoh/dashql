import * as React from 'react';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { EmbeddedComputeDatabase } from '../../platform/database/embedded_database.js';
import { useEmbeddedDatabaseSetup } from '../../platform/database/embedded_database_provider.js';
import type { HyperDBSourceDatabase } from '../../platform/hyperdb/hyperdb_incremental_extract.js';
import { useHttpClient } from '../../platform/http/http_client_provider.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { BASE64URL_CODEC } from '../../utils/base64.js';
import { HyperChannelDatabase } from '../../app/connections/hyper/hyper_channel_database.js';
import { hyperConnectionContext } from '../../app/connections/hyper/hyper_connection_context.js';
import { WebHyperDatabaseClient } from '../../app/connections/hyper/platform/web_hyperdb_http_client.js';
import { hyperLinkChannelParams, parseHyperLinkTarget, type HyperLinkTarget } from '../../app/hyper_link/hyper_link_target.js';

const LOG_CTX = 'demos';

/// The Hyper that a demo reads
export type DemoDataSourceParams =
    /// The HyperDB WASM of the page, the demo fills it itself
    | { kind: 'wasm' }
    /// A remote Hyper with the HTTP v3 API, e.g. of `hyperd run --ui`, filled by someone else
    | { kind: 'remote'; target: HyperLinkTarget };

/// A connected data source of a demo
export interface DemoDataSource {
    /// The params of the source
    params: DemoDataSourceParams;
    /// The Hyper that the queries of the demo read
    database: HyperDBSourceDatabase;
    /// The HyperDB WASM of the page, null for a remote Hyper. Demos only write into their own database.
    embedded: EmbeddedComputeDatabase | null;
    /// The version of the Hyper
    version: string | null;
}

/// The state of the setup of a data source
export interface DemoDataSourceState {
    /// The connected source, null while it is set up or after it failed
    source: DemoDataSource | null;
    /// The error of the setup
    error: string | null;
}

/// Parse a Hyper link, e.g. the one that `hyperd run --ui` prints: `https://dashql.app/?data=<base64url>`.
/// The data is the base64url JSON `{"hyperLink": {"endpoint": ..., "token": ...}}`, a bare data string works as well.
export function parseHyperLinkText(text: string): HyperLinkTarget | null {
    let data = text.trim();
    try {
        data = new URL(data).searchParams.get('data') ?? '';
    } catch {
        // Not a url, the data itself
    }
    if (data.length === 0 || !BASE64URL_CODEC.isValidBase64(data)) return null;
    try {
        const event = JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(data)));
        const { endpoint, token } = (event?.hyperLink ?? {}) as { endpoint?: unknown; token?: unknown };
        if (typeof endpoint !== 'string' || typeof token !== 'string') return null;
        return parseHyperLinkTarget(endpoint, token);
    } catch {
        return null;
    }
}

/// The params of the HTTP v3 channels to a remote Hyper, with its bearer token
function remoteChannelParams(target: HyperLinkTarget): connection.HyperConnectionParams {
    return hyperLinkChannelParams({
        protocol: 'V3_HTTP',
        endpoint: target.endpoint,
        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
    }, target.token);
}

/// Read the version of a Hyper, the first query also checks that the Hyper is reachable
async function readVersion(database: HyperDBSourceDatabase): Promise<string | null> {
    const conn = await database.connect();
    try {
        const version = (await conn.query('select version() as version')).getChild('version')?.get(0);
        return typeof version === 'string' ? version : null;
    } finally {
        await conn.close();
    }
}

/// Set up the data source of a demo, again whenever its params change
export function useDemoDataSource(params: DemoDataSourceParams | null): DemoDataSourceState {
    const logger = useLogger();
    const httpClient = useHttpClient();
    const setupEmbedded = useEmbeddedDatabaseSetup();
    const [state, setState] = React.useState<DemoDataSourceState>({ source: null, error: null });

    React.useEffect(() => {
        setState({ source: null, error: null });
        if (params == null) return;
        let cancelled = false;
        const setup = async (): Promise<DemoDataSource> => {
            if (params.kind === 'wasm') {
                const embedded = await setupEmbedded('demos');
                // The tables of the demo live in the user database of the page, a fresh one per page load
                const database: HyperDBSourceDatabase = {
                    connect: options => embedded.connect({ ...options, defaultDatabase: 'hyper' }),
                };
                return { params, database, embedded, version: await embedded.getVersion() };
            }
            const client = new WebHyperDatabaseClient(httpClient, logger);
            const channelParams = remoteChannelParams(params.target);
            // Every connection is a channel of its own, a remote Hyper keeps no session across the queries of a channel
            const database = new HyperChannelDatabase(clientContext => client.connect(channelParams, hyperConnectionContext(channelParams, clientContext)));
            return { params, database, embedded: null, version: await readVersion(database) };
        };
        setup().then(
            source => { if (!cancelled) setState({ source, error: null }); },
            error => {
                logger.error('Setting up the data source of the demo failed', { kind: params.kind, error: stringifyError(error) }, LOG_CTX);
                if (!cancelled) setState({ source: null, error: error instanceof Error ? error.message : String(error) });
            },
        );
        return () => { cancelled = true; };
    }, [params, setupEmbedded, httpClient, logger]);

    return state;
}
