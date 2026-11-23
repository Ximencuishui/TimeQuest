-- 高考六科满分归一：语数英各 150，物化生各 100，合计 750。
--
-- 只改还带着旧出厂满分的行；用户自己改过的满分保持原样。
-- 目标分（goal）是用户追的分，不跟着满分一起改。

UPDATE subjects SET full_mark = 150
WHERE key IN ('chinese', 'math', 'english') AND full_mark IN (120, 130);

UPDATE subjects SET full_mark = 100
WHERE key IN ('physics', 'chemistry', 'biology') AND full_mark = 80;
