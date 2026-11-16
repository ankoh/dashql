/**
 * Read one classification by its dotted name.
 */

call d360.classification_list (taxonomy_name => 'Compliance_Classifications');

call d360.classification_get (fully_qualified_name => 'Compliance_Classifications.PII');
