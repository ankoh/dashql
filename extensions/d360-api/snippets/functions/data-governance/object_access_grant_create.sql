/**
 * Give a permission set access to an object in a data space.
 *
 * The call is idempotent: a grant that exists comes back as it is. The permission set must already have the data space assigned. Pass `dataspace_name` even though the spec marks it optional.
 */

call cdp.object_access_grant_create (
    permission_set_name => 'DC_Analyst_PermSet',
    dataspace_name => 'default',
    object_api_name => 'Account__dlm'
);

call cdp.object_access_grant_get (
    object_api_name => 'Account__dlm',
    dataspace_name => 'default',
    permission_set_name => 'DC_Analyst_PermSet'
);
