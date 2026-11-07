/**
 * Read a tag taxonomy by its developer name.
 *
 * A taxonomy has one segment, so its fully qualified name is its developer name.
 */

call cdp.tag_taxonomy_list (search_string => 'Compliance');

call cdp.tag_taxonomy_get (fully_qualified_name => 'Compliance_Tags');
