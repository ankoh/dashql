/**
 * List the search indexes of the org, with the names of their chunk and index DMOs.
 *
 * There is no data space option, so filter on `dataspace` yourself. The items show `runtime_status` in the spec's examples, which is not a column: read it from `_raw`.
 */

call cdp.search_index_list ();

call cdp.search_index_get (search_index_api_name_or_id => 'Articles_Search');
