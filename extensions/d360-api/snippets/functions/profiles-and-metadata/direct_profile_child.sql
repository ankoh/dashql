/**
 * Get the child records of a profile record on the tenant host, here the email addresses of an individual, sorted with the primary one first. The child must have a relationship with the parent.
 *
 * The tenant form documents no `filters`. Descending order takes a `-` prefix.
 */

call cdp.direct_profile_child (
    data_model_name => 'Individual__dlm',
    id => '123',
    child_data_model_name => 'ContactPointEmail__dlm',
    fields => 'Email__c,IsPrimary__c',
    order_by => '-IsPrimary__c,Email__c',
    limit => 25,
    offset => 0
);
