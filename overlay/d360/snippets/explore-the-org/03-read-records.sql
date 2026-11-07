/**
 * Step 3 of exploring the org.
 *
 * Read records of that object.
 */

CALL cdp.profile_query (data_model_name => 'ssot__Individual__dlm', filters => '[ssot__FirstName__c=Jean]', fields => 'ssot__Id__c,ssot__LastName__c');
