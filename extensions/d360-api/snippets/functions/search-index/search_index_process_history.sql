/**
 * List the processing runs of a search index, to see why it isn't ready or when it last ran.
 *
 * `offset` starts at 1. Salesforce's tool calls paging here unreliable, so expect the first page. The fields of the rows are not named by any source.
 */

call cdp.search_index_process_history (search_index_api_name_or_id => 'Articles_Search', limit => 20, offset => 1);

call cdp.search_index_get (search_index_api_name_or_id => 'Articles_Search');
