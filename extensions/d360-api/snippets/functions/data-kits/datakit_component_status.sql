/**
 * Check the state of one component that was deployed from a kit, for example after a deploy or while an undeploy removes it.
 *
 * `component_details[].status` is one of `Active`, `Deleting`, `Error` or `Processing`. The list can come back empty and `status` can be missing, so handle both.
 */

call cdp.datakit_component_status (data_kit_name => 'Customer_Kit', component_name => 'Customer__dll');

call cdp.datakit_manifest (data_kit_dev_name => 'Customer_Kit');
