/**
 * Delete a search index and the chunk and index DMOs generated for it.
 *
 * Use the id: a developer name is reported to return 404 even when the index exists. Take the id from the list, and read the index first to be sure it is the right one.
 */

call cdp.search_index_get (search_index_api_name_or_id => '18lTC0000001qPZYAY');

call cdp.search_index_delete (search_index_api_name_or_id => '18lTC0000001qPZYAY');
