/**
 * Pass the tags of an object on to the objects built from it, for example before a data graph depends on them.
 *
 * The body names objects but no tags, up to 20 of them. The spec doesn't say whether the work finishes before the call returns.
 */

call cdp.tag_assignment_list (object_name => 'Individual_DLO__dll');

call cdp.tags_propagate (object_names => ['Individual_DLO__dll', 'Contact_DLO__dll']);
