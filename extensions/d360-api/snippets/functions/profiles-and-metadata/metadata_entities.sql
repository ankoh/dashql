/**
 * List the objects of the org by name, type and category, without their fields, to take an inventory cheaply. Describe the interesting ones afterwards.
 *
 * Only the first batch is readable, since the spec has no way to send the next batch id.
 */

call cdp.metadata_entities (entity_type => 'DataModelObject', entity_category => 'Profile', dataspace => 'default');

call cdp.metadata (entity_name => 'ssot__Individual__dlm');
