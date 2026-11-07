/**
 * Check a streaming transform before creating it, with the same body that create takes.
 *
 * Validation failures come back as a normal answer, so read `issues` for `error_code`, `error_message` and the severity. A `Warning` is not always a failure. A valid body also returns the output object the transform would write, but set the primary key and category yourself before you create.
 */

call cdp.transform_validate (
    name => 'AccountAnon',
    label => 'Account Anon',
    description => 'Account ids without names',
    type => 'STREAMING',
    definition => (
        type = 'SQL',
        version = '63.0',
        expression = $$SELECT Account_Home__dll.Id__c AS Id__c, '***' AS Name__c FROM Account_Home__dll$$,
        target_dlo = 'Account_Home_Anon__dll'
    )
);
