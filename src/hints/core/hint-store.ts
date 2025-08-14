import { createHash } from 'crypto';
import { BrowserHint, PatternType, ToolCall, ValidationResult } from '../types.js';
import { HintDatabase } from '../storage/database.js';
import { HintValidator } from './hint-validator.js';
import { HintMatcher } from './hint-matcher.js';

export class HintStore {
  private db: HintDatabase;
  private validator: HintValidator;
  private matcher: HintMatcher;
  
  constructor() {
    this.db = HintDatabase.getInstance();
    this.validator = new HintValidator();
    this.matcher = new HintMatcher();
  }
  
  async saveHint(hint: Partial<BrowserHint>): Promise<string> {
    // Validate hint
    const validation = this.validator.validateHint(hint);
    if (!validation.valid) {
      throw new Error(`Invalid hint: ${validation.errors.join(', ')}`);
    }
    
    // Generate ID
    const id = this.generateHintId(hint);
    
    // Check for existing hint
    const existing = await this.getHintById(id);
    if (existing) {
      // Conflict resolution - for MVP, just update if new confidence is higher
      if ((hint.confidence || 0.5) > existing.confidence) {
        await this.deactivateHint(existing.id);
      } else {
        throw new Error('Existing hint has higher confidence');
      }
    }
    
    // Prepare hint object
    const fullHint: BrowserHint = {
      id,
      domain: hint.domain!,
      path_pattern: hint.path_pattern,
      url_hash: this.hashUrl(hint.domain! + (hint.path_pattern || '')),
      pattern_type: hint.pattern_type!,
      selector_guard: hint.selector_guard,
      dom_fingerprint: hint.dom_fingerprint,
      recipe: hint.recipe!,
      description: hint.description!,
      context: hint.context,
      success_count: 0,
      failure_count: 0,
      confidence: hint.confidence || 0.5,
      author_id: process.env.CLAUDE_INSTANCE_ID || 'unknown',
      created_at: Date.now(),
      version: 1,
      is_active: true,
      parent_hint_id: hint.parent_hint_id,
      related_hints: hint.related_hints
    };
    
    // Save to database
    this.db.insertHint(fullHint);
    
    return id;
  }
  
  async getHints(url: string, limit: number = 5): Promise<BrowserHint[]> {
    const urlHash = this.hashUrl(url);
    const domain = new URL(url).hostname;
    
    // Get URL-specific hints
    const urlHints = this.db.getHintsByUrl(urlHash, limit);
    
    // Get domain-wide hints
    const domainHints = this.db.getHintsByDomain(domain, Math.floor(limit / 2));
    
    // Combine and deduplicate
    const allHints = [...urlHints];
    const seenIds = new Set(urlHints.map(h => h.id));
    
    for (const hint of domainHints) {
      if (!seenIds.has(hint.id)) {
        allHints.push(hint);
        seenIds.add(hint.id);
      }
    }
    
    // Sort by confidence and recency
    allHints.sort((a, b) => {
      const scoreA = this.calculateScore(a);
      const scoreB = this.calculateScore(b);
      return scoreB - scoreA;
    });
    
    return allHints.slice(0, limit);
  }
  
  async getHintById(id: string): Promise<BrowserHint | null> {
    return this.db.getHintById(id);
  }
  
  async updateHintStats(id: string, success: boolean): Promise<void> {
    this.db.updateHintStats(id, success);
    
    // Record in history
    this.db.recordHistory(id, success);
    
    // Check if hint should be deactivated
    const hint = await this.getHintById(id);
    if (hint && hint.failure_count > 10 && hint.confidence < 0.2) {
      await this.deactivateHint(id);
    }
  }
  
  async findMatchingHints(url: string, dom?: string): Promise<BrowserHint[]> {
    const hints = await this.getHints(url);
    
    if (!dom) {
      return hints;
    }
    
    // Filter by DOM validation
    const validHints: BrowserHint[] = [];
    for (const hint of hints) {
      if (hint.selector_guard) {
        // We'll need to parse DOM string or use a different approach
        // For MVP, assume all hints are valid if they have selector_guard
        validHints.push(hint);
      } else {
        validHints.push(hint);
      }
    }
    
    return validHints;
  }
  
  async resolveConflict(existing: BrowserHint, challenger: Partial<BrowserHint>): Promise<BrowserHint> {
    const existingScore = this.calculateScore(existing);
    const challengerScore = this.calculateScore({
      ...challenger,
      confidence: challenger.confidence || 0.5,
      success_count: challenger.success_count || 0,
      failure_count: challenger.failure_count || 0,
      last_success_at: challenger.last_success_at
    } as BrowserHint);
    
    if (challengerScore > existingScore * 1.5) {
      // Challenger wins
      await this.deactivateHint(existing.id);
      const newId = await this.saveHint({
        ...challenger,
        parent_hint_id: existing.id
      });
      return (await this.getHintById(newId))!;
    }
    
    // Existing wins
    return existing;
  }
  
  async deactivateHint(id: string): Promise<void> {
    this.db.deactivateHint(id);
  }
  
  async pruneStaleHints(daysOld: number = 90): Promise<number> {
    return this.db.pruneStaleHints(daysOld);
  }
  
  private generateHintId(hint: Partial<BrowserHint>): string {
    const content = `${hint.domain}${hint.path_pattern || ''}${hint.selector_guard || ''}${Date.now()}`;
    return createHash('sha1').update(content).digest('hex');
  }
  
  private hashUrl(url: string): string {
    return createHash('sha1').update(url).digest('hex');
  }
  
  private calculateScore(hint: BrowserHint): number {
    const recency = hint.last_success_at 
      ? (Date.now() - hint.last_success_at) / (1000 * 60 * 60 * 24) // days
      : 30; // Default to 30 days old if never successful
    
    const recencyFactor = Math.exp(-recency / 30); // Decay over 30 days
    const usageBonus = Math.log(hint.success_count + 1);
    
    return hint.confidence * recencyFactor * usageBonus;
  }
}