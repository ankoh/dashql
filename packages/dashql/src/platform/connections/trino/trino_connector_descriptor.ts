import type { ConnectorDescriptor } from '../connector_descriptor.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';

/// Trino connections
export const TRINO_CONNECTOR_DESCRIPTOR: ConnectorDescriptor<'trino'> = {
    info: CONNECTOR_INFOS[ConnectorType.TRINO],
    paramsKey: 'trino',
    defaultParams: () => ({ endpoint: '', catalogs: [], auth: { authType: 'AUTH_BASIC' } }),
    withoutDraftRows: ({ draftRows: _rows, ...params }) => params,
    loginHint: params => params.auth?.basic?.username || null,
};
