CREATE TABLE IF NOT EXISTS user_ratings (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(50),
    rating INTEGER NOT NULL DEFAULT 1500,
    solved_easy INTEGER NOT NULL DEFAULT 0,
    solved_medium INTEGER NOT NULL DEFAULT 0,
    solved_hard INTEGER NOT NULL DEFAULT 0,
    total_solved INTEGER NOT NULL DEFAULT 0,
    contests_participated INTEGER NOT NULL DEFAULT 0,
    rank INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_ratings_user_id ON user_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ratings_rating ON user_ratings(rating DESC);
