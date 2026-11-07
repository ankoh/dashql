/**
 * Retry the sync of one member of a data space.
 *
 * No source documents when to call this. The `status` of the member, from the member read, is described as the status of its off-core sync.
 */

call cdp.dataspace_member_sync (dataspace_member_object_name => 'Orders__dll', id_or_name => 'nonDefault');

call cdp.dataspace_member_get (dataspace_member_object_name => 'Orders__dll', id_or_name => 'nonDefault');
