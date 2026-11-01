-- 0007: contact person on the lead. Organisations have people who say yes —
-- extract them when the evidence names them, and let the owner set the name
-- they know (504Yard pattern: "type it there, the greeting personalises").
ALTER TABLE prospect ADD COLUMN contact_name TEXT;
ALTER TABLE prospect ADD COLUMN contact_title TEXT;
