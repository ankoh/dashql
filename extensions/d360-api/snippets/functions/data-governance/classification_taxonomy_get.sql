/**
 * Read a classification taxonomy by its name.
 */

call d360.classification_taxonomy_list (search_string => 'Compliance');

call d360.classification_taxonomy_get (name => 'Compliance_Classifications');
