import type * as core from '../../core/index.js';
import type { Logger } from '../../platform/logger/logger.js';
import type { RuntimeOptions } from '../runtime.js';
import type { StorageBackend } from '../../platform/storage/storage_backend.js';
import type { OAuthFlow } from '../../platform/oauth_flow.js';
import { TASK_UPDATE_SCHEDULER } from '../store/update_scheduler.js';
import { WebHttpClient } from '../../platform/web_http_client.js';
import { createDashQLCoreSetup } from '../../platform/node/node_core.js';

/// Node has no OAuth flow, a connection that needs one can't be authorized in Node
const NO_OAUTH_FLOW: OAuthFlow = {
    redirectVariant: 'NATIVE_LINK_FLOW',
    redirectCallbackUrl: null,
    debugMode: false,
    flavor: null,
    authorizeWithRedirectPage: () => Promise.reject(new Error('Node has no OAuth flow to authorize a connection')),
    authorizeWithLoopback: () => Promise.reject(new Error('Node has no OAuth flow to authorize a connection')),
};

export interface NodePlatformOptions {
    logger: Logger;
    /// Where the workbooks are kept, e.g. a NativeStorageBackend over NODE_FILE_SYSTEM for a workbook folder; none for
    /// a runtime that keeps nothing
    storage: StorageBackend | null;
    /// The core, by default the one of the file next to the package
    core?: core.DashQL;
}

/// The platform of Node for createRuntime: fetch, the core from its file, updates at the end of a task
export async function createNodePlatform(options: NodePlatformOptions): Promise<RuntimeOptions> {
    return {
        logger: options.logger,
        storage: options.storage,
        http: new WebHttpClient(),
        scheduler: TASK_UPDATE_SCHEDULER,
        oauthFlow: NO_OAUTH_FLOW,
        core: options.core ?? await createDashQLCoreSetup()('runtime'),
    };
}
