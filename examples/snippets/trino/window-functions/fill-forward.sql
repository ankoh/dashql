/**
 * @description
 * Fill missing readings with the last known value.
 * A running count of the known values groups every gap with the value before it.
 */

with readings(measured_at, temperature) as (
    values
        (timestamp '2026-01-01 10:00:00', 21.5),
        (timestamp '2026-01-01 11:00:00', null),
        (timestamp '2026-01-01 12:00:00', null),
        (timestamp '2026-01-01 13:00:00', 23.0),
        (timestamp '2026-01-01 14:00:00', null)
)
select
    measured_at,
    temperature,
    max(temperature) over (partition by known_values) as temperature_filled
from (
    select readings.*, count(temperature) over (order by measured_at) as known_values
    from readings
) grouped
order by measured_at;
