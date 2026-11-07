/**
 * Create several tags in one request, one of them with classifications.
 *
 * Send parents and children in separate calls, parents first. Up to 200 items per request.
 */

call cdp.tag_bulk_create (
    tags => [
        (
            fully_qualified_name = 'Compliance_Tags.PII.Phone',
            label = 'Phone Number',
            description = 'Phone numbers (personal or business).'
        ),
        (
            fully_qualified_name = 'Compliance_Tags.PII.CreditCard',
            label = 'Credit Card Number',
            description = 'Credit card PAN, PCI-regulated.',
            classification_fully_qualified_names = [
                'Compliance_Classifications.PII',
                'Compliance_Classifications.Sensitive'
            ]
        )
    ]
);

call cdp.tag_list (taxonomy_name => 'Compliance_Tags', search_string => 'PII');
