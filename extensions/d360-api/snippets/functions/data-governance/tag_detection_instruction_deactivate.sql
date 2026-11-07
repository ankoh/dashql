/**
 * Switch off the detection instruction of a tag, so the AI no longer uses it to suggest the tag.
 *
 * This deactivates the instruction and leaves the tag in place.
 */

call cdp.tag_detection_instruction_get (fully_qualified_name => 'Compliance_Tags.PII.CreditCard');

call cdp.tag_detection_instruction_deactivate (fully_qualified_name => 'Compliance_Tags.PII.CreditCard');
