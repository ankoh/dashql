/**
 * Change an activation: its refresh type, what it skips, and the constant campaign values it adds to every row.
 *
 * It is a `PUT` and the spec still requires `refresh_type`. No source says whether omitted fields keep their values, so compare with `activation_get` afterwards.
 */

call cdp.activation_update (
    activation_id => '85RVF000000CEf72AG',
    refresh_type => 'INCREMENTAL',
    should_exclude_deletes => true,
    should_exclude_updates => true,
    static_data_config => (
        static_data = [(name = 'Campaign', value = 'Spring_2026'), (name = 'Region', value = 'EMEA')]
    )
);

call cdp.activation_get (activation_id => '85RVF000000CEf72AG');
