/**
 * Accept tag suggestions the auto tagging job found, so they become tag assignments.
 *
 * Only suggestions that are still pending can be approved. An id that isn't gets its own error in the result, so check every row. Approving creates the assignment, see `assignment_id` on the suggestion.
 */

call cdp.tag_suggestion_list (object_name => 'Individual_DLO__dll', status => 'New');

call cdp.tag_suggestions_approve (ids => ['1dg000000000001', '1dg000000000002']);

call cdp.tag_suggestion_get (id => '1dg000000000001');
