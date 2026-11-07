/**
 * Read one tag by its dotted name.
 *
 * A tag path is `<Taxonomy>.<Level1>[.<Level2>]`.
 */

call cdp.tag_list (taxonomy_name => 'Compliance_Tags', search_string => 'Email');

call cdp.tag_get (fully_qualified_name => 'Compliance_Tags.PII.Email');
