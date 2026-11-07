/**
 * Step 3 of semantic search, reads the index of step 2.
 *
 * Repeat until `runtime_status` is `READY`. This takes several minutes.
 */

call cdp.search_index_get (search_index_api_name_or_id => 'Articles_Search');
