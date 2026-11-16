/**
 * Fetch the OpenAPI definition of the endpoints of an Ingestion API connection, to see what you can push into a data lake object.
 *
 * The answer is a binary YAML file. Other connector types answer with an internal server error when they have no OpenAPI definition.
 */

call d360.connection_schema_list (connection_id => '9cgaj0000012O5hAAE');

call d360.connection_endpoint_list (connection_id => '9cgaj0000012O5hAAE');
