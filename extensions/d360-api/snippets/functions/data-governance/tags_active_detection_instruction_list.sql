/**
 * Review which tags of a taxonomy have a detection instruction and what it says.
 *
 * Each tag comes with its active instruction, if it has one.
 */

call cdp.tags_active_detection_instruction_list (fully_qualified_name => 'Compliance_Tags', limit => 50, _pages => 2);
