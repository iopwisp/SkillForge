-- V2: frontend-compat columns and tables (categories, favorites, hints, starter code)

CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

-- Seed a few starter categories so the Categories page has content
INSERT INTO categories (slug, name, description, icon, color) VALUES
    ('algorithms',        'Algorithms',        'Classic algorithmic problems.',            'Cpu',      '#6366f1'),
    ('data-structures',   'Data Structures',   'Arrays, trees, graphs, hash tables.',       'Boxes',    '#10b981'),
    ('dynamic-programming','Dynamic Programming','Memoization, tabulation, DP patterns.',   'Layers',   '#f59e0b'),
    ('math',              'Math',              'Number theory, combinatorics, geometry.',   'Sigma',    '#ec4899'),
    ('strings',           'Strings',           'Parsing, pattern matching, manipulation.',  'Type',     '#0ea5e9'),
    ('sql',               'SQL',               'Query writing and database problems.',      'Database', '#14b8a6')
ON CONFLICT (slug) DO NOTHING;

-- Extend tasks with optional frontend fields
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS category_id   BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_premium    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS hints         TEXT,
    ADD COLUMN IF NOT EXISTS starter_code  TEXT,
    ADD COLUMN IF NOT EXISTS sql_setup     TEXT,
    ADD COLUMN IF NOT EXISTS function_name VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_tasks_category_id ON tasks(category_id);

-- Per-user favorites (slug or id identifies task; we use id)
CREATE TABLE IF NOT EXISTS favorites (
    user_id  BIGINT NOT NULL,
    task_id  BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_task_id ON favorites(task_id);
