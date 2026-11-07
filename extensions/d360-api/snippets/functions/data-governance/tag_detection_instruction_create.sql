/**
 * Tell the AI how to recognize a tag, with a short instruction.
 *
 * Posting again replaces the active instruction. The text is at most 100 characters. The instruction is in use once `off_core_sync_state` is `Synced`, or `Error` when it failed.
 */

call cdp.tag_detection_instruction_create (
    fully_qualified_name => 'Compliance_Tags.PII.CreditCard',
    instruction_txt => 'Detect credit card numbers: 16-digit Luhn-valid sequences, card-type prefixes.'
);

call cdp.tag_detection_instruction_get (fully_qualified_name => 'Compliance_Tags.PII.CreditCard');
