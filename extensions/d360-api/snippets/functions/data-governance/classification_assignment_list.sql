/**
 * List the tags linked to one classification.
 *
 * Page size goes from 5 to 200.
 */

call cdp.classification_assignment_list (
    classification_fully_qualified_name => 'Compliance_Classifications.PII',
    limit => 50
);
