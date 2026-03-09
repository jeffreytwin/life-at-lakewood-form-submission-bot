-- Add gender column to agents table
ALTER TABLE agents ADD COLUMN gender TEXT CHECK (gender IN ('male', 'female')) DEFAULT NULL;
