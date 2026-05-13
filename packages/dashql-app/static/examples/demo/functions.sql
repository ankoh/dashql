create function revenue(l_extendedprice decimal, l_discount decimal) returns decimal;
create function charge(l_extendedprice decimal, l_discount decimal, l_tax decimal) returns decimal;
create function days_between(start_date date, end_date date) returns integer;

