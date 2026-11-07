/**
 * Step 3 of the data space.
 *
 * Repeat until `status` is `ACTIVE`.
 */

CALL cdp.dataspace_member_get (id_or_name => 'nonDefault', dataspace_member_object_name => 'Orders__dll');
