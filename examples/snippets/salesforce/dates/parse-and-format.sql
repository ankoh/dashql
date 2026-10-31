/**
 * @description
 * Parse dates and timestamps in other formats with `to_date` and `to_timestamp`, and format them with `to_char`.
 */

with imports(record_id, date_text, timestamp_text) as (
    values ('R-1', '03/15/2026', '15.03.2026 14:30'), ('R-2', '12/01/2025', '01.12.2025 08:05')
)
select
    record_id,
    to_date(date_text, 'MM/DD/YYYY') as parsed_date,
    to_timestamp(timestamp_text, 'DD.MM.YYYY HH24:MI') as parsed_timestamp,
    to_char(to_timestamp(timestamp_text, 'DD.MM.YYYY HH24:MI'), 'YYYY-MM-DD"T"HH24:MI') as iso_text,
    to_char(to_date(date_text, 'MM/DD/YYYY'), 'Mon YYYY') as month_label
from imports
order by record_id;
