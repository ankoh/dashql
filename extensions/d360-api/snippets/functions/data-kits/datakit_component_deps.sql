/**
 * Show what depends on a component that was deployed from a kit.
 *
 * `component_type` is required and takes one of the types the description of the option lists, such as `DataLakeObject` or `CalculatedInsight`. Check the dependencies before an undeploy, which removes components in the order you give.
 */

call cdp.datakit_component_deps (
    data_kit_name => 'Customer_Kit',
    component_name => 'Customer__dll',
    component_type => 'DataLakeObject',
    dataspace => 'default'
);
