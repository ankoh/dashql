/**
 * See every tag a classification is linked to, in pages of 50.
 *
 * The rows are of the same kind as the ones of `classification_assignment_list`.
 */

call cdp.classification_assignments_classification_list (
    fully_qualified_name => 'Compliance_Classifications.PII',
    limit => 50,
    _pages => 2
);
