/**
 * List the components of the org that can go into a data kit, to find the names you pass to a create or an update.
 *
 * Filter by type and page with `limit` (1 to 200) and `offset`. On orgs with large kit inventories the call has returned a 500.
 */

call cdp.datakit_components (
    component_type => 'DataLakeObject',
    data_kit_dev_name => 'Customer_Kit',
    limit => 50,
    offset => 0
);
