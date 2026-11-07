/**
 * Set up identity resolution for individuals: three ways to match two records as one person, and how to pick the winning value for each DMO.
 *
 * Criteria in one match rule are ANDed, and the rules are ORed. Reconciliation has a default rule per DMO, and one field can override it with its own rule and its own source order. Map the data lake objects to the DMOs first. The ruleset starts as a draft; look it up in the list for its `id`.
 */

call cdp.ir_create (
    label => 'Customer Match',
    description => 'Email, or name plus phone, or device serial number',
    configuration_type => 'Individual',
    ruleset_id => 'cust',
    does_run_automatically => false,
    match_rules => [
        (
            label = 'Normalized Email',
            criteria = [(
                entity_name = 'ssot__ContactPointEmail__dlm',
                field_name = 'ssot__EmailAddress__c',
                match_method_type = 'exactnormalized',
                should_match_on_blank = false
            )]
        ),
        (
            label = 'Fuzzy Name and Normalized Phone',
            criteria = [
                (
                    entity_name = 'ssot__Individual__dlm',
                    field_name = 'ssot__FirstName__c',
                    match_method_type = 'fuzzy',
                    should_match_on_blank = false
                ),
                (
                    entity_name = 'ssot__Individual__dlm',
                    field_name = 'ssot__LastName__c',
                    match_method_type = 'exact',
                    should_match_on_blank = false
                ),
                (
                    entity_name = 'ssot__ContactPointPhone__dlm',
                    field_name = 'ssot__FormattedE164PhoneNumber__c',
                    match_method_type = 'exactnormalized',
                    should_match_on_blank = false
                )
            ]
        ),
        (
            label = 'Device Serial Number',
            criteria = [(
                entity_name = 'ssot__PartyIdentification__dlm',
                field_name = 'ssot__IdentificationNumber__c',
                match_method_type = 'exact',
                case_sensitive_match = false,
                should_match_on_blank = false,
                party_identification_info = (party_name = 'Pacemaker Serial Number')
            )]
        )
    ],
    reconciliation_rules => [
        (
            entity_name = 'ssot__Individual__dlm',
            rule_type = 'lastupdated',
            should_ignore_empty_value = true,
            fields = [(
                field_name = 'ssot__Id__c',
                rule_type = 'sourcesequence',
                should_ignore_empty_value = true,
                sources = [(name = 'Contact_Home__dll'), (name = 'Lead_Home__dll')]
            )]
        ),
        (entity_name = 'ssot__ContactPointEmail__dlm', rule_type = 'mostfrequent', should_ignore_empty_value = true),
        (
            entity_name = 'ssot__ContactPointPhone__dlm',
            rule_type = 'sourcesequence',
            should_ignore_empty_value = true,
            sources = [(name = 'Contact_Home__dll'), (name = 'Lead_Home__dll')]
        ),
        (entity_name = 'ssot__PartyIdentification__dlm', rule_type = 'mostfrequent', should_ignore_empty_value = true)
    ]
);

call cdp.ir_list ();
