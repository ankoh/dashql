/**
 * Step 9 of the order pipeline, needs the mappings of step 7 to be active.
 *
 * Merge the records of a person by their email. Take `:identity_resolution` from the result of the first call, and repeat the last call until `last_job_status` is `SUCCESS`. This can take 15 to 20 minutes.
 */

call cdp.ir_create (
    label => 'Email Match',
    configuration_type => 'Individual',
    ruleset_id => 'mail',
    match_rules => [(
        label = 'Normalized Email',
        criteria = [(
            entity_name = 'ssot__ContactPointEmail__dlm',
            field_name = 'ssot__EmailAddress__c',
            match_method_type = 'exactnormalized',
            should_match_on_blank = false
        )]
    )],
    reconciliation_rules => [(
        entity_name = 'ssot__Individual__dlm',
        rule_type = 'lastupdated',
        should_ignore_empty_value = true
    )]
);

call cdp.ir_run (identity_resolution => :identity_resolution);

call cdp.ir_get (identity_resolution => :identity_resolution);
