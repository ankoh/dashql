/**
 * Remove deployed components of a kit again, in the order of the list.
 *
 * List the dependents first, such as a transform before the object it writes. Check the order with `datakit_component_deps`. No source documents a job status for an undeploy, so check each component afterwards with `datakit_component_status`.
 */

call cdp.datakit_undeploy (
    data_kit_name => 'Customer_Kit',
    async_mode => true,
    dataspace => 'default',
    components => [
        (type = 'DataTransform', name = 'Customer_Transform'),
        (type = 'DataLakeObject', name = 'Customer__dll')
    ]
);

call cdp.datakit_component_status (data_kit_name => 'Customer_Kit', component_name => 'Customer__dll');
