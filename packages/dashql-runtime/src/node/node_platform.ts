import type { Logger } from '@ankoh/dashql-platform/platform/logger/logger';
import type { RuntimePlatform } from '../runtime.js';
import type { StorageBackend } from '@ankoh/dashql-platform/storage/storage_backend';
import type { OAuthFlow } from '@ankoh/dashql-platform/oauth/oauth_flow';
import { TASK_UPDATE_SCHEDULER } from '../store/store.js';
import { WebHttpClient } from '@ankoh/dashql-platform/platform/http/web_http_client';
import { createDashQLCoreSetup } from '@ankoh/dashql-platform/node/node_core';

/// Node has no OAuth flow yet, `dashql auth` brings one (docs/wip/dashql_runtime.md)
const NO_OAUTH_FLOW: OAuthFlow = {
    redirectVariant: 'NATIVE_LINK_FLOW',
    redirectCallbackUrl: null,
    debugMode: false,
    flavor: null,
    authorizeWithRedirectPage: () => Promise.reject(new Error('authorizing a connection in Node comes with `dashql auth`')),
    authorizeWithLoopback: () => Promise.reject(new Error('authorizing a connection in Node comes with `dashql auth`')),
};

export interface NodePlatformOptions {
    logger: Logger;
    /// Where the workbooks are kept, e.g. a NativeStorageBackend over NODE_FILE_SYSTEM for a workbook folder
    storage: StorageBackend;
    /// How connectors authorize, none by default
    oauthFlow?: OAuthFlow;
}

/// The platform of Node for createRuntime: fetch, the core from its file, updates at the end of a task
export function createNodePlatform(options: NodePlatformOptions): RuntimePlatform {
    return {
        logger: options.logger,
        storage: options.storage,
        http: new WebHttpClient(options.logger),
        scheduler: TASK_UPDATE_SCHEDULER,
        oauthFlow: options.oauthFlow ?? NO_OAUTH_FLOW,
        setupCore: createDashQLCoreSetup(),
    };
}
