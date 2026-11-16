/**
 * Retry the sync of a data space.
 *
 * No source documents when to call this. The only progress field the spec has is the `status` of the space.
 */

call d360.dataspace_sync (id_or_name => 'nonDefault');

call d360.dataspace_get (id_or_name => 'nonDefault');
