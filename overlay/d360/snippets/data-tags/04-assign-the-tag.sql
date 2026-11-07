/**
 * Step 4 of tagging data.
 *
 * Tag a field.
 */

CALL cdp.tag_assignment_create (tag_fully_qualified_name => 'Compliance_Tags.PII.Email', object_name => 'Individual_DLO__dll', field_name => 'Email');
