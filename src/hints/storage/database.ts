import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

export class HintDatabase {
  private db: Database.Database;
  private static instance: HintDatabase | null = null;
  
  private constructor(dbPath?: string) {
    const path = dbPath || process.env.HINT_DB_PATH || join(process.cwd(), 'hints.db');
    
    // Ensure directory exists
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    
    // Open database
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL'); // Better concurrency
    this.db.pragma('foreign_keys = ON');  // Enable foreign key constraints
    
    // Initialize schema
    this.initSchema();
  }
  
  static getInstance(dbPath?: string): HintDatabase {
    if (!HintDatabase.instance) {
      HintDatabase.instance = new HintDatabase(dbPath);
    }
    return HintDatabase.instance;
  }
  
  private initSchema(): void {
    // For now, inline the schema instead of reading from file
    const schema = `
-- Browser Hints Database Schema
-- SQLite3 compatible

-- Primary hints table
CREATE TABLE IF NOT EXISTS hints (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    path_pattern TEXT,
    url_hash TEXT NOT NULL,
    pattern_type TEXT NOT NULL,
    selector_guard TEXT,
    dom_fingerprint TEXT,
    recipe TEXT NOT NULL,
    description TEXT NOT NULL,
    context TEXT,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    confidence REAL DEFAULT 0.5,
    author_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    last_success_at INTEGER,
    version INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    parent_hint_id TEXT,
    related_hints TEXT
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
    success INTEGER NOT NULL,
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
    resolution TEXT,
    FOREIGN KEY (active_hint_id) REFERENCES hints(id),
    FOREIGN KEY (challenger_hint_id) REFERENCES hints(id)
);

CREATE INDEX IF NOT EXISTS idx_conflicts_domain ON hint_conflicts(domain);
CREATE INDEX IF NOT EXISTS idx_conflicts_resolved ON hint_conflicts(resolved_at);
    `;
    
    // Execute schema
    this.db.exec(schema);
  }
  
  // Prepared statements for performance
  private statements = {
    insertHint: null as Database.Statement | null,
    getHintById: null as Database.Statement | null,
    getHintsByUrl: null as Database.Statement | null,
    getHintsByDomain: null as Database.Statement | null,
    updateStats: null as Database.Statement | null,
    updateConfidence: null as Database.Statement | null,
  };
  
  private prepareStatements(): void {
    if (!this.statements.insertHint) {
      this.statements.insertHint = this.db.prepare(`
        INSERT INTO hints (
          id, domain, path_pattern, url_hash, pattern_type,
          selector_guard, dom_fingerprint, recipe, description,
          context, author_id, created_at, confidence
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);
      
      this.statements.getHintById = this.db.prepare(`
        SELECT * FROM hints WHERE id = ? AND is_active = 1
      `);
      
      this.statements.getHintsByUrl = this.db.prepare(`
        SELECT * FROM hints 
        WHERE url_hash = ? AND is_active = 1
        ORDER BY confidence DESC
        LIMIT ?
      `);
      
      this.statements.getHintsByDomain = this.db.prepare(`
        SELECT * FROM hints 
        WHERE domain = ? AND is_active = 1
        ORDER BY confidence DESC
        LIMIT ?
      `);
      
      this.statements.updateStats = this.db.prepare(`
        UPDATE hints 
        SET 
          success_count = success_count + ?,
          failure_count = failure_count + ?,
          last_used_at = ?
        WHERE id = ?
      `);
      
      this.statements.updateConfidence = this.db.prepare(`
        UPDATE hints 
        SET confidence = (success_count + 1.0) / (success_count + failure_count + 2.0)
        WHERE id = ?
      `);
    }
  }
  
  // Public methods
  insertHint(hint: any): void {
    this.prepareStatements();
    this.statements.insertHint!.run(
      hint.id,
      hint.domain,
      hint.path_pattern || null,
      hint.url_hash,
      hint.pattern_type,
      hint.selector_guard || null,
      hint.dom_fingerprint || null,
      JSON.stringify(hint.recipe),
      hint.description,
      hint.context ? JSON.stringify(hint.context) : null,
      hint.author_id,
      hint.created_at,
      hint.confidence || 0.5
    );
  }
  
  getHintById(id: string): any | null {
    this.prepareStatements();
    const row = this.statements.getHintById!.get(id);
    return row ? this.parseHintRow(row) : null;
  }
  
  getHintsByUrl(urlHash: string, limit: number = 5): any[] {
    this.prepareStatements();
    const rows = this.statements.getHintsByUrl!.all(urlHash, limit);
    return rows.map(row => this.parseHintRow(row));
  }
  
  getHintsByDomain(domain: string, limit: number = 5): any[] {
    this.prepareStatements();
    const rows = this.statements.getHintsByDomain!.all(domain, limit);
    return rows.map(row => this.parseHintRow(row));
  }
  
  updateHintStats(id: string, success: boolean): void {
    this.prepareStatements();
    
    const successDelta = success ? 1 : 0;
    const failureDelta = success ? 0 : 1;
    const now = Date.now();
    
    // Update stats
    this.statements.updateStats!.run(successDelta, failureDelta, now, id);
    
    // Update confidence
    this.statements.updateConfidence!.run(id);
    
    // Update last_success_at if successful
    if (success) {
      this.db.prepare('UPDATE hints SET last_success_at = ? WHERE id = ?').run(now, id);
    }
  }
  
  recordHistory(hintId: string, success: boolean, errorMessage?: string, executionTime?: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO hint_history (hint_id, executed_at, success, error_message, execution_time_ms, author_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      hintId,
      Date.now(),
      success ? 1 : 0,
      errorMessage || null,
      executionTime || null,
      process.env.CLAUDE_INSTANCE_ID || 'unknown'
    );
  }
  
  deactivateHint(id: string): void {
    this.db.prepare('UPDATE hints SET is_active = 0 WHERE id = ?').run(id);
  }
  
  pruneStaleHints(daysOld: number): number {
    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const result = this.db.prepare(`
      UPDATE hints 
      SET is_active = 0 
      WHERE last_used_at < ? AND confidence < 0.3
    `).run(cutoff);
    
    return result.changes;
  }
  
  private parseHintRow(row: any): any {
    return {
      ...row,
      recipe: JSON.parse(row.recipe),
      context: row.context ? JSON.parse(row.context) : null,
      related_hints: row.related_hints ? JSON.parse(row.related_hints) : [],
      is_active: row.is_active === 1
    };
  }
  
  close(): void {
    this.db.close();
    HintDatabase.instance = null;
  }
}