/**
 * Browse the catalog of connectors that Data 360 offers, with all their fields, to find the one to connect to.
 *
 * `name` is the token to pass to `connector_metadata`. It is not always the `connector_type` of a connection: CRM connections have `SalesforceDotCom`, the catalog calls it `SalesforceCRM`.
 */

call cdp.connector_list (field_group => 'BIG', order_by => 'label ASC');

call cdp.connector_metadata (connector_type => 'AwsRdsSqlServer');
