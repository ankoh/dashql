/**
 * List the calculated insights of a data space with their full definitions.
 *
 * `definition_type` is needed in practice, since one org returned nothing without it. `offset` is required, so pass `0`, and continue with `page_token` from `collection.nextPageToken`. Every item carries its `expression`, so a `ci_get` per item isn't needed.
 */

call cdp.ci_list (offset => 0, definition_type => 'CALCULATED_METRIC', dataspace => 'default', batch_size => 100);
