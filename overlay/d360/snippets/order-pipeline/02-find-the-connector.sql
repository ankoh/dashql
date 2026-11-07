/**
 * Step 2 of the order pipeline.
 *
 * Look up the Snowflake connector, and the attributes that a connection of it needs.
 */

call cdp.connector_list (filters => 'name=SNOWFLAKE');

call cdp.connector_metadata (connector_type => 'SNOWFLAKE');
