/**
 * Step 1 of exploring the org.
 *
 * List the data model objects of the org, without their fields. All of this workflow only reads.
 */

CALL cdp.metadata_entities (entity_type => 'DataModelObject', entity_category => 'Profile');
