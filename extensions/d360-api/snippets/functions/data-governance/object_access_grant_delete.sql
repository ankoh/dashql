/**
 * Revoke the access a permission set has to one object in a data space.
 *
 * A grant is identified by the object, the data space and the permission set, so pass all three.
 */

call cdp.object_access_grant_get (
    object_api_name => 'Account__dlm',
    dataspace_name => 'default',
    permission_set_name => 'DC_Analyst_PermSet'
);

call cdp.object_access_grant_delete (
    object_api_name => 'Account__dlm',
    dataspace_name => 'default',
    permission_set_name => 'DC_Analyst_PermSet'
);
