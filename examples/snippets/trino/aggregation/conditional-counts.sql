/**
 * @description
 * Count rows per condition in one pass, turning categories into columns.
 */

with tickets(team, status) as (
    values ('core', 'open'), ('core', 'closed'), ('core', 'open'),
           ('web', 'closed'), ('web', 'closed')
)
select
    team,
    count(*) filter (where status = 'open') as open_tickets,
    count(*) filter (where status = 'closed') as closed_tickets,
    count(*) as all_tickets
from tickets
group by team
order by team;
