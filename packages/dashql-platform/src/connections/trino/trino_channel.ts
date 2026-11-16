import type { TrinoApiEndpoint } from "./trino_api_client.js";
import type { TrinoSessionDefaults } from './trino_catalogs.js';

// The query executor of the core speaks the protocol of Trino (`dashql_core_runtime::trino`), a channel holds what it
// needs: the endpoint with the access token and the defaults of the session.

export interface TrinoChannelInterface {
    /// Destroy the connection
    close(): Promise<void>;
}

export class TrinoChannel implements TrinoChannelInterface {
    /// The trino api endpoint
    endpoint: TrinoApiEndpoint;
    /// The catalog and schema of the names that statements leave out
    defaults: TrinoSessionDefaults;

    /// Constructor
    constructor(endpoint: TrinoApiEndpoint, defaults: TrinoSessionDefaults) {
        this.endpoint = endpoint;
        this.defaults = defaults;
    }

    /// Destroy the connection
    async close(): Promise<void> {
        return;
    }
}
