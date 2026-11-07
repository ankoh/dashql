/**
 * Read the fields and the category of one data model object, standard or custom.
 *
 * The name carries the `__dlm` suffix. A 404 can also mean you have no access to the DMO. Fields the schema doesn't list, such as `dataSpaceName`, are in `_raw`.
 */

call cdp.dmo_list (limit => 50, order_by => 'ASC');

call cdp.dmo_get (data_model_object_name => 'ssot__Individual__dlm');
