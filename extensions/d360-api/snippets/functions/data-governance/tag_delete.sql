/**
 * Delete one tag, with its child tags and its assignments.
 *
 * System tags can't be deleted. The delete finishes in the background: it is done when `tag_get` returns 404.
 */

call cdp.tag_get (fully_qualified_name => 'Compliance_Tags.PII.Phone');

call cdp.tag_delete (fully_qualified_name => 'Compliance_Tags.PII.Phone');
