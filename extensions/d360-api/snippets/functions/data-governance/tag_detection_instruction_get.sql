/**
 * Read the active detection instruction of a tag, the text the AI uses to find it.
 *
 * It returns the one active instruction. Older versions can't be read.
 */

call cdp.tags_active_detection_instruction_list (fully_qualified_name => 'Compliance_Tags');

call cdp.tag_detection_instruction_get (fully_qualified_name => 'Compliance_Tags.PII.CreditCard');
