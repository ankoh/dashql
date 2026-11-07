/**
 * Read one search index, by id or developer name, to see whether it is ready.
 *
 * Poll it after create or update: `runtime_status` is `READY` or `FAILED`, in upper case, and is not a column, so read it from `_raw`. The developer name has no `__dlm` suffix.
 */

call cdp.search_index_list ();

call cdp.search_index_get (search_index_api_name_or_id => 'Articles_Search');
