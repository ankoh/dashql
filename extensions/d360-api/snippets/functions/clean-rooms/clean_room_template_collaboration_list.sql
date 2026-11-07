/**
 * List the collaborations that use one type of template, for example all the overlap analyses.
 *
 * The spec gives no list of values for `use_case_template_type`. Its template schemas have `Custom` and `Overlap`.
 */

call cdp.clean_room_template_collaboration_list (
    use_case_template_type => 'Overlap',
    order_by => 'created_date DESC',
    limit => 20
);
