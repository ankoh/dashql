/**
 * Set the components of an existing kit to a new list.
 *
 * The update is destructive: whatever you leave out is removed, so always send the complete list. The body can't change the kit's name or label, which means recreating the kit for that.
 */

call cdp.datakit_manifest (data_kit_dev_name => 'Customer_Kit');

call cdp.datakit_components_update (
    data_kit_dev_name => 'Customer_Kit',
    components => [
        (type = 'DataLakeObject', info = (name = 'Customer__dll', label = 'Customer')),
        (type = 'DataLakeObject', info = (name = 'Order__dll', label = 'Order')),
        (type = 'CalculatedInsight', info = (name = 'Customer_Order_Summary__cio', label = 'Customer Order Summary'))
    ]
);
