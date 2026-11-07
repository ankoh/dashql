/**
 * Read one classification by its dotted name.
 */

call cdp.classification_list (taxonomy_name => 'Compliance_Classifications');

call cdp.classification_get (fully_qualified_name => 'Compliance_Classifications.PII');
