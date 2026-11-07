/**
 * Remove many tag assignments at once, by their ids.
 *
 * Find the ids in the list of assignments. Check each item of the result.
 */

call cdp.tag_assignment_list (object_name => 'Individual_DLO__dll', field_name => 'Email');

call cdp.tag_assignment_bulk_delete (ids => ['9aa000000000001', '9aa000000000002']);
