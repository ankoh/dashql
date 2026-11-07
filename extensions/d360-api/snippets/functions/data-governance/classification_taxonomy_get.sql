/**
 * Read a classification taxonomy by its name.
 */

call cdp.classification_taxonomy_list (search_string => 'Compliance');

call cdp.classification_taxonomy_get (name => 'Compliance_Classifications');
