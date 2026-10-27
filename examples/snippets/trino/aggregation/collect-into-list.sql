-- @description
-- Collect the values of a group into an ordered list and a comma-separated string.
-- @end

with team_members(team, member, joined) as (
    values ('core', 'Ada', 2019), ('core', 'Alan', 2021), ('web', 'Grace', 2020),
           ('web', 'Edsger', 2018), ('web', 'Barbara', 2022)
)
select
    team,
    array_agg(member order by joined) as members,
    listagg(member, ', ') within group (order by member) as member_names
from team_members
group by team
order by team;
