/**
 * Check the credentials and parameters of a SQL Server connection on Amazon RDS before saving it with `connection_create`. Nothing is created. The credentials are `:sales_db_user` and `:sales_db_password`.
 *
 * Send `method` even though the spec marks it optional. The attribute names come from `connector_metadata`.
 */

call cdp.connection_test (
    connector_type => 'AwsRdsSqlServer',
    method => 'Ingress',
    credentials => [
        (param_name = 'username', value = :sales_db_user),
        (param_name = 'password', value = :sales_db_password)
    ],
    parameters => [
        (param_name = 'jdbc_connection_url', value = 'sales-db.abc123.us-east-1.rds.amazonaws.com:1433'),
        (param_name = 'DATABASE', value = 'sales'),
        (param_name = 'SCHEMA', value = 'dbo')
    ]
);
