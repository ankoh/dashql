/**
 * Get profile records on the tenant host by a key, here by email address through `search_key`, not by the primary key. Find the DMO and its fields first.
 */

call cdp.direct_profile_metadata_get (data_model_name => 'ContactPointEmail__dlm');

call cdp.direct_profile_get (
    data_model_name => 'ContactPointEmail__dlm',
    id => 'jean.dupont@example.com',
    search_key => 'Email__c',
    fields => 'Email__c,IsPrimary__c'
);
