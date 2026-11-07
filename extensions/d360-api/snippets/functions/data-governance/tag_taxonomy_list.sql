/**
 * Browse the tag taxonomies, searched by developer name or label.
 */

call cdp.tag_taxonomy_list (search_string => 'Tags', limit => 25, _pages => 2);
