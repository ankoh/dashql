name: simple
prev:
  text: |-
    DECLARE PARAMETER a TYPE INTEGER;
    SELECT 1 INTO foo WHERE a = global.a
  setup:
    - type: DROP_TABLE
      origin: 1
      target_id: 1
      target_name_qualified: global.foo 
      target_name_short: foo
  actions:
    - type: PARAMETER
      origin: 0
      required_for:
        - 1
      target_id: 0
      target_qualified: global.a
      target_short: a
      status: COMPLETED
    - type: TABLE_CREATE
      origin: 1
      depends_on:
        - 0
      target_id: 1
      target_qualified: global.foo
      target_short: foo
      script: |-
        SELECT 1 INTO foo
      status: COMPLETED
next:
  text: |-
    DECLARE PARAMETER a TYPE INTEGER;
    SELECT 1 INTO foo WHERE a = global.a
