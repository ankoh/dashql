/**
 * Find everything a tag has been put on.
 */

call d360.tag_assignments_tag_list (fully_qualified_name => 'Compliance_Tags.PII.Email', limit => 50, _pages => 2);
