/**
 * Turn down tag suggestions that don't fit.
 *
 * Only pending suggestions can be rejected. Others come back with their own error in the result.
 */

call cdp.tag_suggestion_list (object_name => 'Account_DLO__dll', status => 'New');

call cdp.tag_suggestions_reject (ids => ['1dg000000000003', '1dg000000000004']);

call cdp.tag_suggestion_get (id => '1dg000000000003');
