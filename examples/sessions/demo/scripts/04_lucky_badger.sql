/* @vis vegalite
   {
     "mark": "point",
     "encoding": {
       "x": {
         "field": "x",
         "type": "quantitative"
       },
       "y": {
         "field": "y",
         "type": "quantitative"
       }
     }
   }
*/
SELECT v AS x, random() AS y
FROM generate_series(1, 100) t(v);
