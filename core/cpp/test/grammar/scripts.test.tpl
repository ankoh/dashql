name: demo
input: |-
  -- This script outlines basic concepts of the SQL extension DashQL.
  -- Delete everything when you're ready and start from scratch.
  
  -- Declare a dynamic input field on top of your dashboard.
  -- Ref: https://docs.dashql.com/grammar/param
  DECLARE PARAMETER country AS TEXT (
      default_value = 'DE'
  );
  
  -- Load data from external sources like HTTP REST APIs.
  -- Ref: https://docs.dashql.com/grammar/load
  LOAD wheather_csv FROM http (
      url = 'https://cdn.dashql.com/demo/weather/{{country}}'
  );
  
  -- Interpret the data as SQL table.
  -- Ref: https://docs.dashql.com/grammar/extract
  EXTRACT wheather FROM wheather_csv;
  
  -- Run arbitrary SQL within your browser.
  -- Ref: https://docs.dashql.com/grammar/query
  SELECT 1 INTO weather_avg FROM wheather;
  
  -- Visualize tables and views.
  -- Ref: https://docs.dashql.com/grammar/viz
  VIZ weather_avg USING LINE;
