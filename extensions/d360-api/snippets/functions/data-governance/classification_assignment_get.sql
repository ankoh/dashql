/**
 * Read one classification assignment, the link of a classification to a tag.
 */

call cdp.classification_assignment_list (classification_fully_qualified_name => 'Compliance_Classifications.PII');

call cdp.classification_assignment_get (id => '9aa000000000050');
