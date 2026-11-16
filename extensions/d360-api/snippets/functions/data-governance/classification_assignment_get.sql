/**
 * Read one classification assignment, the link of a classification to a tag.
 */

call d360.classification_assignment_list (classification_fully_qualified_name => 'Compliance_Classifications.PII');

call d360.classification_assignment_get (id => '9aa000000000050');
