/**
 * List the classifications of one taxonomy, narrowed by a search word.
 *
 * Classifications from all taxonomies come back when `taxonomy_name` is left out.
 */

call cdp.classification_list (taxonomy_name => 'Compliance_Classifications', search_string => 'PII', limit => 50);
