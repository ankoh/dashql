/**
 * Delete a tag taxonomy together with the tags in it.
 *
 * System taxonomies can't be deleted, and the spec also lists a 412 for a taxonomy with dependencies or child tags. The delete finishes in the background: it is done when `tag_taxonomy_get` returns 404.
 */

call cdp.tag_taxonomy_get (fully_qualified_name => 'Marketing_Tags');

call cdp.tag_taxonomy_delete (fully_qualified_name => 'Marketing_Tags');
