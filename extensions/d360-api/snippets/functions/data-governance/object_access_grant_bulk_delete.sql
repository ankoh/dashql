/**
 * Revoke a permission set's access to many objects of one data space in one request.
 *
 * A name listed twice returns "Duplicate identifier in request". The sources disagree whether a grant that doesn't exist is skipped or an item error, so don't treat that item as fatal.
 */

call cdp.object_access_grant_list (permission_set_name => 'DC_Analyst_PermSet');

call cdp.object_access_grant_bulk_delete (
    permission_set_name => 'DC_Analyst_PermSet',
    dataspace_name => 'default',
    object_api_names => ['Account__dlm', 'revenue_insights__cio']
);
