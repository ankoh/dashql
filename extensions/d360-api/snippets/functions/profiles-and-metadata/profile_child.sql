/**
 * Fetch the child records of one profile record, here the email addresses of an individual. The child must have a relationship with the parent, which the profile metadata lists.
 *
 * `fields` picks child fields, while `filters` applies to the parent only. `offset` needs `order_by` on this route.
 */

call cdp.profile_child (
    data_model_name => 'ssot__Individual__dlm',
    id => '100005',
    child_data_model_name => 'ContactPointEmail__dlm',
    fields => 'Id__c,EmailAddress__c',
    order_by => 'EmailAddress__c ASC',
    batch_size => 25,
    offset => 0
);
