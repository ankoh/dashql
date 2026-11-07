/**
 * Read one member of a data space by the developer name of its data lake object, with its filter and sync status.
 *
 * In the result, `filter.conditions` is a flat array with operators such as `EqualsOperator`, which differs from the shape you send when adding a member.
 */

call cdp.dataspace_member_list (id_or_name => 'default', batch_size => 200);

call cdp.dataspace_member_get (dataspace_member_object_name => 'Orders__dll', id_or_name => 'default');
