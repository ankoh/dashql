/**
 * Put a tag on an object, or on one field of it.
 *
 * Assigning a child tag also applies its parent tag. `field_name` needs `object_name`.
 */

call cdp.tag_assignment_create (
    tag_fully_qualified_name => 'Compliance_Tags.PII.Email',
    object_name => 'Individual_DLO__dll',
    field_name => 'Email'
);

call cdp.tag_assignment_list (object_name => 'Individual_DLO__dll', field_name => 'Email');
