/**
 * Read the grant of one permission set on one object.
 *
 * Pass the object, the data space and the permission set, since together they identify the grant.
 */

call d360.object_access_grant_list (permission_set_name => 'DC_Analyst_PermSet');

call d360.object_access_grant_get (
    object_api_name => 'Account__dlm',
    dataspace_name => 'default',
    permission_set_name => 'DC_Analyst_PermSet'
);
