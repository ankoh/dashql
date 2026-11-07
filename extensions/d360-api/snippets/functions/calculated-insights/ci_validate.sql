/**
 * Check the SQL of an insight before creating or updating it.
 *
 * Only `expression` is required, so the insight doesn't need to exist. The call is not in the spec, and no source says which SQL rules it enforces or how it reports a failure.
 */

call cdp.ci_validate (
    definition_type => 'CALCULATED_METRIC',
    dataspace_name => 'default',
    expression => $$
        SELECT Order__dlm.CustomerId__c AS customer_id__c, SUM(Order__dlm.Total__c) AS total__c
        FROM Order__dlm
        GROUP BY Order__dlm.CustomerId__c
    $$
);
