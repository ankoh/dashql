/**
 * Delete a custom data space.
 *
 * Read it first to be sure of the name. No source says what happens to its members, or whether `default` can be deleted, so don't try that. A 412 in the response has no explanation in the spec.
 */

call cdp.dataspace_get (id_or_name => 'nonDefault');

call cdp.dataspace_delete (id_or_name => 'nonDefault');
