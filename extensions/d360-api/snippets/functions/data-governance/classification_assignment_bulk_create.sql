/**
 * Link several classifications to their tags in one request, each classification with a list of tags.
 *
 * A bulk call can succeed with failed items, so check `has_errors` and each `results[].statusCode`.
 */

call cdp.classification_assignment_bulk_create (
    assignments => [
        (
            classification_fully_qualified_name = 'Compliance_Classifications.PII',
            tag_fully_qualified_names = [
                'Compliance_Tags.PII.Email',
                'Compliance_Tags.PII.CreditCard',
                'Compliance_Tags.PII.Phone'
            ]
        ),
        (
            classification_fully_qualified_name = 'Compliance_Classifications.Sensitive',
            tag_fully_qualified_names = ['Compliance_Tags.PII.CreditCard']
        )
    ]
);

call cdp.classification_assignment_list (
    classification_fully_qualified_name => 'Compliance_Classifications.Sensitive'
);
