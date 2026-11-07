/**
 * Step 5 of exploring the org.
 *
 * Read the values of one insight.
 */

CALL cdp.insights_query (ci_name => 'Avg_Spends__cio', dimensions => 'Id__c,FirstName__c', measures => 'Avg_Spend__c', batch_size => 100);
