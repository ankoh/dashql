%%

[\t ]+  ;
\n      ;

,   ","
;   ";"
'   "'"
"   '"'
\.  "."
\(  "("
\)  ")"
\[  '['
\]  ']'
\*  "*"
\+  "+"
=   "="
$   "$"

(?i)as          "AS"
(?i)csv         "CSV"
(?i)date        "DATE"
(?i)datetime    "DATETIME"
(?i)declare     "DECLARE"
(?i)delimiter   "DELIMITER"
(?i)encoding    "ENCODING"
(?i)extract     "EXTRACT"
(?i)false       "FALSE"
(?i)file        "FILE"
(?i)float       "FLOAT"
(?i)format      "FORMAT"
(?i)from        "FROM"
(?i)get         "GET"
(?i)header      "HEADER"
(?i)http        "HTTP"
(?i)integer     "INTEGER"
(?i)load        "LOAD"
(?i)method      "METHOD"
(?i)parameter   "PARAMETER"
(?i)post        "POST"
(?i)put         "PUT"
(?i)query       "QUERY"
(?i)quote       "QUOTE"
(?i)text        "TEXT"
(?i)time        "TIME"
(?i)timestamp   "TIMESTAMP"
(?i)true        "TRUE"
(?i)type        "TYPE"
(?i)url         "URL"
(?i)using       "USING"
(?i)visualize   "VISUALIZE"

'(\\.|[^\\'])*'     "SINGLY_QUOTED_STRING"
"(\\.|[^\\"])*"     "DOUBLY_QUOTED_STRING"
(?i)[a-z][a-z0-9_]* "IDENTIFIER"

(?i)select[^;]* "SQL_SELECT"
(?i)with[^;]*   "SQL_WITH"
