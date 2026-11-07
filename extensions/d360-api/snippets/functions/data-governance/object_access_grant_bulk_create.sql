/**
 * Grant a permission set access to many objects of one data space in one request.
 *
 * Up to 200 objects per request. A failed item carries its errors in `results[].result`.
 */

call cdp.object_access_grant_bulk_create (
    permission_set_name => 'DC_Analyst_PermSet',
    dataspace_name => 'default',
    object_api_names => ['Account__dlm', 'Contact__dlm', 'revenue_insights__cio']
);

call cdp.object_access_grant_list (permission_set_name => 'DC_Analyst_PermSet');
