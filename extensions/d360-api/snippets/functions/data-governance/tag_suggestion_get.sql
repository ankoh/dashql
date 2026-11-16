/**
 * Read one tag suggestion, to judge it before it is approved or rejected.
 */

call d360.tag_suggestion_list (object_name => 'Individual_DLO__dll', status => 'New');

call d360.tag_suggestion_get (id => '1dg000000000001');
