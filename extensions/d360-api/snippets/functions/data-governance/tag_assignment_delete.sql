/**
 * Remove a tag from the object or field it was put on.
 *
 * Read the assignment first to be sure it is the right one. The tag itself stays.
 */

call cdp.tag_assignment_get (id => '9aa000000000001');

call cdp.tag_assignment_delete (id => '9aa000000000001');
