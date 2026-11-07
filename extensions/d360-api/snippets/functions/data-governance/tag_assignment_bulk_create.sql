/**
 * Put several tags on many fields in one request, each tag with its targets.
 *
 * Every item has a tag and a list of targets, an object and a field each. Check the result of each item, a failed target doesn't fail the call.
 */

call cdp.tag_assignment_bulk_create (
    assignments => [
        (
            tag_fully_qualified_name = 'Compliance_Tags.PII.Email',
            targets = [
                (object_name = 'Individual_DLO__dll', field_name = 'Email'),
                (object_name = 'Contact_DLO__dll', field_name = 'PersonalEmail')
            ]
        ),
        (
            tag_fully_qualified_name = 'Compliance_Tags.PII.CreditCard',
            targets = [(object_name = 'Payment_DLO__dll', field_name = 'CardPAN')]
        )
    ]
);

call cdp.tag_assignments_tag_list (fully_qualified_name => 'Compliance_Tags.PII.Email');
