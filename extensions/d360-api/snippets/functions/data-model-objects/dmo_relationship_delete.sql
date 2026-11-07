/**
 * Remove a relationship between a field of one DMO and a field of another.
 *
 * `name` is the id or developer name of the relationship, which the list of the source DMO shows.
 */

call cdp.dmo_relationship_list (
    data_model_object_name => 'SalesOrders__dlm',
    dataspace => 'default',
    status => 'Active'
);

call cdp.dmo_relationship_delete (
    name => 'SalesOrders_IndividualId_map_ssot__Individual_ssot__Id_1759312001213',
    dataspace => 'default'
);
