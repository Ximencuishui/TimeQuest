-- Existing rows may store "H:MM". Text overlap compares those strings in
-- lexicographic order, so pad a single-digit hour to "HH:MM" before any read.
UPDATE task_sessions
SET start_time = printf(
      '%02d:%02d',
      CAST(substr(start_time, 1, instr(start_time, ':') - 1) AS INTEGER),
      CAST(substr(start_time, instr(start_time, ':') + 1) AS INTEGER)
    )
WHERE length(start_time) < 5
  AND instr(start_time, ':') = 2;

UPDATE task_sessions
SET end_time = printf(
      '%02d:%02d',
      CAST(substr(end_time, 1, instr(end_time, ':') - 1) AS INTEGER),
      CAST(substr(end_time, instr(end_time, ':') + 1) AS INTEGER)
    )
WHERE length(end_time) < 5
  AND instr(end_time, ':') = 2;
