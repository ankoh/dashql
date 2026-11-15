import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as auth from '@ankoh/dashql-jsonschema/auth.js';

export class TrinoApiEndpoint {
    // The endpoint url
    endpoint: string;
    // The auth params
    authParams: auth.TrinoAuthParams;
    // The auth state
    oauthState: connection.TrinoOAuthState | null;

    constructor(endpoint: string, params: auth.TrinoAuthParams) {
        this.endpoint = endpoint;
        this.authParams = params;
        this.oauthState = null;
    }
}
