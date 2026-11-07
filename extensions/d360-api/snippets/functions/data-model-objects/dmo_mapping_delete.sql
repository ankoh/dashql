/**
 * Cut the link between a data lake object and a data model object, so nothing flows from that source into the DMO anymore.
 *
 * The stream and the DMO stay. Read the mapping first, then delete it by its developer name. Sources disagree on whether the call works in every org, so read the mapping list afterwards.
 */

call cdp.dmo_mapping_get (
    object_source_target_map_developer_name => 'Orders_snow_SalesOrders',
    dataspace => 'default'
);

call cdp.dmo_mapping_delete (
    object_source_target_map_developer_name => 'Orders_snow_SalesOrders',
    dataspace => 'default'
);
