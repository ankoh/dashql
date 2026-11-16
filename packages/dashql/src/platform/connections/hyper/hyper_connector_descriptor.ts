import type { ConnectorDescriptor } from '../connector_descriptor.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';

/// Direct-to-Hyper connections
export const HYPER_CONNECTOR_DESCRIPTOR: ConnectorDescriptor<'hyper'> = {
    info: CONNECTOR_INFOS[ConnectorType.HYPER],
    paramsKey: 'hyper',
    defaultParams: () => ({ protocol: 'WASM', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } }),
    withoutDraftRows: ({ draftRows: _rows, ...params }) => params,
    loginHint: () => null,
};
