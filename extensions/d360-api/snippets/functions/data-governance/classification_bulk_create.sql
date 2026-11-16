/**
 * Create several classifications in one request, some with tag links.
 *
 * A request holds up to 200 items. If a tag link of an item fails, the classification is still created.
 */

call d360.classification_bulk_create (
    classifications => [
        (
            fully_qualified_name = 'Compliance_Classifications.PII',
            label = 'PII',
            description = 'Personally identifiable information.'
        ),
        (
            fully_qualified_name = 'Compliance_Classifications.Sensitive',
            label = 'Sensitive',
            description = 'Sensitive data requiring handling controls.',
            tag_fully_qualified_names = ['Compliance_Tags.PII.CreditCard']
        )
    ]
);

call d360.classification_list (taxonomy_name => 'Compliance_Classifications');
