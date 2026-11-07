/**
 * List the schemas of one database on a database connection, the step before listing its tables.
 *
 * Which keys `advanced_attributes` takes varies by connector. For Snowflake it is `database`.
 */

call cdp.connection_databases_list (connection_id => '9cgaj0000012O5hAAE');

call cdp.connection_db_schemas_list (
    connection_id => '9cgaj0000012O5hAAE',
    advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA')
);
