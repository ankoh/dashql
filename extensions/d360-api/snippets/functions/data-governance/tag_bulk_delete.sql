/**
 * Delete several tags in one request.
 *
 * Each deletion cascades to the child tags and assignments of that tag.
 */

call d360.tag_list (taxonomy_name => 'Compliance_Tags', limit => 50);

call d360.tag_bulk_delete (fully_qualified_names => ['Compliance_Tags.PII.Phone', 'Compliance_Tags.PII.Obsolete']);
