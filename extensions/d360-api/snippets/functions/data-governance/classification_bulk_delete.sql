/**
 * Delete several classifications in one request.
 *
 * Each deletion cascades to the child classifications and assignments of that classification.
 */

call d360.classification_list (taxonomy_name => 'Compliance_Classifications', search_string => 'Sensitive');

call d360.classification_bulk_delete (fully_qualified_names => ['Compliance_Classifications.Sensitive']);
