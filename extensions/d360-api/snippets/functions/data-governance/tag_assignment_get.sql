/**
 * Read one tag assignment by its id.
 */

call cdp.tag_assignment_list (object_name => 'Individual_DLO__dll', field_name => 'Email');

call cdp.tag_assignment_get (id => '9aa000000000001');
