/**
 * Remove many classification links at once, by their ids.
 *
 * The ids come from the list of assignments. Check each item of the result, a bulk call can succeed with failed items.
 */

call cdp.classification_assignment_list (
    classification_fully_qualified_name => 'Compliance_Classifications.PII',
    limit => 50
);

call cdp.classification_assignment_bulk_delete (ids => ['9aa000000000050', '9aa000000000053']);
