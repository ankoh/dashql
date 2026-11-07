/**
 * Browse the classification taxonomies, searched by developer name or label.
 */

call cdp.classification_taxonomy_list (search_string => 'Compliance', limit => 25, _pages => 2);
