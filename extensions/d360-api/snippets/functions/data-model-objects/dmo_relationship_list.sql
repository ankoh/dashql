/**
 * List the active custom relationships of a DMO, to see which other objects it joins to.
 *
 * Results page by `limit` (default 20), so use `_pages` on a busy object. A DMO without relationships returns no body, which comes back as zero rows. Without `status` the list also holds inactive relationships.
 */

call cdp.dmo_relationship_list (
    data_model_object_name => 'ssot__Individual__dlm',
    dataspace => 'default',
    creation_type => 'Custom',
    status => 'Active',
    limit => 20,
    _pages => 3
);
