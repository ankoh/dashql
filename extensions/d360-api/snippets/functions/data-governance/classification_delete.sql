/**
 * Delete a classification by its dotted name.
 *
 * System classifications can't be deleted. The delete finishes in the background: it is done when `classification_get` returns 404.
 */

call cdp.classification_get (fully_qualified_name => 'Compliance_Classifications.Sensitive');

call cdp.classification_delete (fully_qualified_name => 'Compliance_Classifications.Sensitive');
