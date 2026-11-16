/**
 * Delete a classification by its dotted name.
 *
 * System classifications can't be deleted. The delete finishes in the background: it is done when `classification_get` returns 404.
 */

call d360.classification_get (fully_qualified_name => 'Compliance_Classifications.Sensitive');

call d360.classification_delete (fully_qualified_name => 'Compliance_Classifications.Sensitive');
