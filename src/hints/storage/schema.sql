-- Browser Hints Database Schema
-- SQLite3 compatible

-- Primary hints table
CREATE TABLE IF NOT EXISTS hints (
    id TEXT PRIMARY KEY,              -- SHA1(domain+path+selector+timestamp)
    domain TEXT NOT NULL,             -- example.com
    path_pattern TEXT,                -- /login/* or exact path
    url_hash TEXT NOT NULL,           -- SHA1(full_url) for fast lookup
    
    -- Pattern classification
    pattern_type TEXT NOT NULL,       -- login|form_fill|navigation|interaction|wait
    selector_guard TEXT,              -- CSS selector that must exist
    dom_fingerprint TEXT,             -- Hash of key DOM elements
    
    -- The actual solution
    recipe TEXT NOT NULL,             -- JSON array of tool calls
    description TEXT NOT NULL,        -- One-line explanation
    
    -- Context (JSON)
    context TEXT,                     -- JSON object with viewport, auth, etc.
    
    -- Authority metrics
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    confidence REAL DEFAULT 0.5,      -- Calculated: (success+1)/(success+failure+2)
    
    -- Metadata
    author_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    last_success_at INTEGER,
    version INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,      -- Boolean: 0 or 1
    
    -- Relationships
    parent_hint_id TEXT,
    related_hints TEXT                -- JSON array of hint IDs
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_domain ON hints(domain);
CREATE INDEX IF NOT EXISTS idx_url_hash ON hints(url_hash);
CREATE INDEX IF NOT EXISTS idx_confidence ON hints(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_last_used ON hints(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_type ON hints(pattern_type);
CREATE INDEX IF NOT EXISTS idx_active ON hints(is_active);

-- Hint execution history
CREATE TABLE IF NOT EXISTS hint_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hint_id TEXT NOT NULL,
    executed_at INTEGER NOT NULL,
    success INTEGER NOT NULL,         -- Boolean: 0 or 1
    error_message TEXT,
    execution_time_ms INTEGER,
    author_id TEXT NOT NULL,
    FOREIGN KEY (hint_id) REFERENCES hints(id)
);

CREATE INDEX IF NOT EXISTS idx_history_hint ON hint_history(hint_id);
CREATE INDEX IF NOT EXISTS idx_history_time ON hint_history(executed_at DESC);

-- Conflicting hints tracking
CREATE TABLE IF NOT EXISTS hint_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    path_pattern TEXT,
    active_hint_id TEXT,
    challenger_hint_id TEXT,
    resolved_at INTEGER,
    resolution TEXT,  -- 'active_won'|'challenger_won'|'merged'
    FOREIGN KEY (active_hint_id) REFERENCES hints(id),
    FOREIGN KEY (challenger_hint_id) REFERENCES hints(id)
);

CREATE INDEX IF NOT EXISTS idx_conflicts_domain ON hint_conflicts(domain);
CREATE INDEX IF NOT EXISTS idx_conflicts_resolved ON hint_conflicts(resolved_at);