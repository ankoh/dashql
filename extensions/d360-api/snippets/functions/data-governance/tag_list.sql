/**
 * Find the tags of one taxonomy by a search word.
 *
 * Without `taxonomy_name` the tags of all taxonomies are listed.
 */

call cdp.tag_list (taxonomy_name => 'Compliance_Tags', search_string => 'Email', limit => 50);
