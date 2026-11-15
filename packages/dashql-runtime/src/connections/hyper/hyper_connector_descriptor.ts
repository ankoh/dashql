import type { ConnectorDescriptor } from '../connector_descriptor.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';

/// The protocol of the setup params of a Hyper connection
const protocolOf = (details: { setupParams: Record<string, unknown> | null }) => details.setupParams?.protocol as string | undefined;

/// Direct-to-Hyper connections
export const HYPER_CONNECTOR_DESCRIPTOR: ConnectorDescriptor<'hyper'> = {
    info: CONNECTOR_INFOS[ConnectorType.HYPER],
    paramsKey: 'hyper',
    defaultParams: () => ({ protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } }),
    withoutDraftRows: ({ draftRows: _rows, ...params }) => params,
    sanitizeForSharing(params) {
        // Arbitrary headers and query parameters may carry credentials under any name.
        const { metadata: _metadata, queryParameters: _queryParameters, ...hyper } = params;
        return { ...hyper, tls: { clientKeyPath: "", clientCertPath: "", caCertsPath: "" } };
    },
    loginHint: () => null,
    // The gRPC metadata stays out, its headers may carry credentials that change with every token.
    // The query parameters are session settings that may change the results.
    cacheSignature: params => ({
        case: "hyper",
        protocol: params.protocol,
        channelArgs: {
            endpoint: params.endpoint,
            tls: params.tls
        },
        attachedDatabases: (params.attachedDatabases || [])
            .map((d: any) => ({ path: d.path, alias: d.alias }))
            .sort((a: any, b: any) => a.path > b.path ? 1 : -1),
        queryParameters: params.queryParameters ? Object.entries(params.queryParameters).sort(([a,], [b]) => a > b ? 1 : -1) : []
    }),
    // A Hyper server runs statements in parallel, the embedded HyperDB-WASM one at a time
    maxConcurrentQueries: details => protocolOf(details) != null && protocolOf(details) !== 'WASM' ? 4 : 1,
    // The embedded HyperDB-WASM database is created anew with every page load. Its functions are the builtins of
    // Hyper and stay persisted.
    catalogIsDurable: params => params.protocol !== 'WASM',
    // The embedded HyperDB-WASM database reads the attachments of a workbook from OPFS
    readsAttachments: details => protocolOf(details) === 'WASM',
};
