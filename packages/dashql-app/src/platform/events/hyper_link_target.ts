import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

/// Hosts of this machine, e.g. of `hyperd run --ui`
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/// A Hyper that a link points the app at, e.g. the hyperd of `hyperd run --ui`.
/// The link is an app event, `?data=` with the base64url JSON `{"hyperLink": {"endpoint": ..., "token": ...}}`.
export interface HyperLinkTarget {
    /// The base url of the HTTP v3 API of the Hyper
    endpoint: string;
    /// The bearer token of the Hyper
    token: string;
}

/// Parse the target of a Hyper link, null unless it names an endpoint and a token.
/// An endpoint on this machine may speak http, any other endpoint must speak https.
export function parseHyperLinkTarget(endpoint: string | null, token: string | null): HyperLinkTarget | null {
    if (endpoint == null || token == null || token.length === 0) return null;
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) return null;
    return { endpoint: url.origin, token };
}

/// Does the link point at a Hyper on this machine?
export function isLoopbackHyperLink(target: HyperLinkTarget): boolean {
    return LOOPBACK_HOSTS.has(new URL(target.endpoint).hostname);
}

/// The params of the channel to the Hyper of a link, its HTTP v3 API with the token of the link
export function hyperLinkChannelParams(params: connection.HyperConnectionParams, token: string): connection.HyperConnectionParams {
    return {
        ...params,
        protocol: 'V3_HTTP',
        metadata: {
            'x-hyperdb-workload': 'dashql',
            ...params.metadata,
            authorization: `Bearer ${token}`,
        },
    };
}
