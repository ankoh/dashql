import type * as core from '../../core/index.js';
import type { Logger } from '../../platform/platform/logger/logger.js';
import type { RuntimePlatform } from '../runtime.js';
import type { StorageBackend } from '../../platform/storage/storage_backend.js';
import type { OAuthFlow } from '../../platform/oauth/oauth_flow.js';
import { TASK_UPDATE_SCHEDULER } from '../store/update_scheduler.js';
import { WebHttpClient } from '../../platform/platform/http/web_http_client.js';
import { createDashQLCoreSetup } from '../../platform/node/node_core.js';

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
    /// The core, by default the one of the file next to the package
    core?: core.DashQL;
}

/// The platform of Node for createRuntime: fetch, the core from its file, updates at the end of a task
export async function createNodePlatform(options: NodePlatformOptions): Promise<RuntimePlatform> {
    return {
        logger: options.logger,
        storage: options.storage,
        http: new WebHttpClient(options.logger),
        scheduler: TASK_UPDATE_SCHEDULER,
        oauthFlow: options.oauthFlow ?? NO_OAUTH_FLOW,
        core: options.core ?? await createDashQLCoreSetup()('runtime'),
    };
}
