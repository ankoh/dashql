/**
 * Retry the sync of a data space.
 *
 * No source documents when to call this. The only progress field the spec has is the `status` of the space.
 */

call cdp.dataspace_sync (id_or_name => 'nonDefault');

call cdp.dataspace_get (id_or_name => 'nonDefault');
