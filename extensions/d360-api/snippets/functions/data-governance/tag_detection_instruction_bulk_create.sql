/**
 * Write the detection instructions of several tags of one taxonomy at once.
 *
 * The path names the taxonomy, each item a tag in it. An item replaces the active instruction of its tag. Each text is at most 100 characters. Once synced, `off_core_sync_state` is `Synced`, or `Error` when it failed.
 */

call cdp.tag_detection_instruction_bulk_create (
    fully_qualified_name => 'Compliance_Tags',
    detection_instructions => [
        (
            tag_fully_qualified_name = 'Compliance_Tags.PII.CreditCard',
            instruction_txt = 'Detect credit card numbers: 16-digit Luhn-valid sequences, card-type prefixes.'
        ),
        (
            tag_fully_qualified_name = 'Compliance_Tags.PII.SSN',
            instruction_txt = 'Detect US Social Security Numbers: NNN-NN-NNNN format or 9-digit numeric sequences.'
        )
    ]
);

call cdp.tags_active_detection_instruction_list (fully_qualified_name => 'Compliance_Tags');
