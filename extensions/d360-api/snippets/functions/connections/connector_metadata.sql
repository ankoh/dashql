/**
 * Read what a connector needs: its attributes, which of them are secure, and its features. This is the only place the API names the `param_name` entries of `credentials` and `parameters`.
 *
 * Pass the catalog `name` from `connector_list`, not the `connector_type` of a connection, or it answers with not found.
 */

call cdp.connector_list (field_group => 'MEDIUM', filters => 'name=AwsRdsSqlServer');

call cdp.connector_metadata (connector_type => 'AwsRdsSqlServer');
