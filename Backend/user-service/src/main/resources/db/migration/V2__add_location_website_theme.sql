-- V2: frontend-compat columns (location replaces country, plus website + theme)

ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS location VARCHAR(100),
    ADD COLUMN IF NOT EXISTS website  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS theme    VARCHAR(10) NOT NULL DEFAULT 'dark';

-- Carry over any existing `country` value into `location` so existing users don't lose data.
UPDATE user_profiles SET location = country WHERE location IS NULL AND country IS NOT NULL;
