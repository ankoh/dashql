/**
 * Change several classifications in one request: descriptions, labels and tag links.
 *
 * Tags are validated against the state before the batch. If a tag link fails the classification is still updated, but the link change isn't applied and an error is reported.
 */

call cdp.classification_bulk_update (
    items => [
        (fully_qualified_name = 'Compliance_Classifications.PII', description = 'All PII classifications.'),
        (fully_qualified_name = 'Compliance_Classifications.Sensitive', label = 'Sensitive Data'),
        (
            fully_qualified_name = 'Compliance_Classifications.Restricted',
            tag_fully_qualified_names = ['Compliance_Tags.PII.SSN', 'Compliance_Tags.PII.CreditCard']
        )
    ]
);

call cdp.classification_list (taxonomy_name => 'Compliance_Classifications');
