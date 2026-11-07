/**
 * Step 2 of the order pipeline.
 *
 * Look up the Snowflake connector, and the attributes that a connection of it needs.
 */

CALL cdp.connector_list (filters => 'name=SNOWFLAKE');
CALL cdp.connector_metadata (connector_type => 'SNOWFLAKE');
