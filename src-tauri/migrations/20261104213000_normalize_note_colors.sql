-- Option B: scrub historical notes.color to the UI whitelist (default yellow).
UPDATE notes
SET color = 'yellow'
WHERE color NOT IN ('yellow', 'orange', 'green', 'blue', 'pink', 'purple');
