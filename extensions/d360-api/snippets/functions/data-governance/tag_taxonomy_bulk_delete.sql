/**
 * Delete several tag taxonomies and all their tags in one request.
 */

call cdp.tag_taxonomy_list (search_string => 'Tags');

call cdp.tag_taxonomy_bulk_delete (names => ['Marketing_Tags', 'Unused_Tags']);
