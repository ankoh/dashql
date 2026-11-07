/**
 * Step 1 of the data kit.
 *
 * In the source org, put a data lake object into a kit.
 */

call cdp.datakit_create (
    data_kit_dev_name => 'Customer_Kit',
    label => 'Customer Kit',
    data_kit_type => 'None',
    components => [(type = 'DataLakeObject', info = (name = 'Customer__dll', label = 'Customer'))]
);
