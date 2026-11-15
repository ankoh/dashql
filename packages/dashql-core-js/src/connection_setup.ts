import type { DashQL } from './api.js';
import type * as glue from './wasm/dashql_core.js';

/// The setups of the connectors and the health checks of the Rust runtime
/// (`packages/dashql-core-runtime/src/connection_setup/`, see docs/wip/core_runtime.md). A run drives the setup of a
/// connector on a host of its own: the host applies the actions to the connection, runs the OAuth flow of the
/// platform, sends the requests and keeps the channels of the setup.

export type {
    ConnectionSetupAction,
    ConnectionSetupHost,
    ConnectionSetupOAuthFlowInfo,
    ConnectionSetupOutcome,
    ConnectionSetupSalesforceChannel,
    ConnectionSetupTrinoChannel,
} from './wasm/dashql_core.js';

/// A run of a setup: `done` resolves with its outcome, `cancel` stops it at its next step
export interface DashQLConnectionSetupRun {
    readonly done: Promise<glue.ConnectionSetupOutcome>;
    cancel(): void;
}

/// The connector of a health check
export type DashQLHealthCheckConnector = 'trino' | 'hyper' | 'salesforce';

function wrap(run: glue.ConnectionSetupRun): DashQLConnectionSetupRun {
    // The promise is read once, the run is freed with its outcome
    const done = run.done as Promise<glue.ConnectionSetupOutcome>;
    let freed = false;
    const free = () => {
        if (!freed) {
            freed = true;
            run.free();
        }
    };
    void done.then(free, free);
    return {
        done,
        cancel: () => {
            if (!freed) run.cancel();
        },
    };
}

export class DashQLConnectionSetup {
    constructor(protected readonly bindings: DashQL['bindings']) { }

    /// Set up a Trino connection with its params, the result is `{ channel }`
    trino(host: glue.ConnectionSetupHost, params: object, forceReLogin: boolean): DashQLConnectionSetupRun {
        return wrap(this.bindings.connectionSetupTrino(host, JSON.stringify(params), forceReLogin));
    }

    /// Set up a Salesforce or Database.com connection with the redirect page of the app, the result is
    /// `{ channel, tokens, userInfo }`
    salesforce(host: glue.ConnectionSetupHost, dbcom: boolean, params: object, config: { oauthRedirect?: string }, forceReLogin: boolean): DashQLConnectionSetupRun {
        return wrap(this.bindings.connectionSetupSalesforce(host, dbcom, JSON.stringify(params), JSON.stringify(config), forceReLogin));
    }

    /// Log in to Salesforce without a channel, the result is `{ tokens, userInfo }`
    authenticateSalesforce(host: glue.ConnectionSetupHost, params: object, config: { oauthRedirect?: string }, forceReLogin: boolean): DashQLConnectionSetupRun {
        return wrap(this.bindings.connectionSetupAuthenticateSalesforce(host, JSON.stringify(params), JSON.stringify(config), forceReLogin));
    }

    /// Set up a Hyper connection, the result is `{ channel }`
    hyper(host: glue.ConnectionSetupHost, params: object): DashQLConnectionSetupRun {
        return wrap(this.bindings.connectionSetupHyper(host, JSON.stringify(params)));
    }

    /// Check the health of a channel that the host keeps under its id
    healthCheck(host: glue.ConnectionSetupHost, connector: DashQLHealthCheckConnector, channel: number): DashQLConnectionSetupRun {
        return wrap(this.bindings.connectionSetupHealthCheck(host, connector, channel));
    }
}
