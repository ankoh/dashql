/**
 * List the tags put on an object, or on one field of it.
 *
 * `field_name` only works together with `object_name`. To list by tag instead, use `tag_assignments_tag_list`.
 */

call cdp.tag_assignment_list (object_name => 'Individual_DLO__dll', field_name => 'Email', limit => 25);
