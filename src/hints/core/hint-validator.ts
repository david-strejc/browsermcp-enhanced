import { BrowserHint, ValidationResult, QualityScore, ToolCall } from '../types.js';

export class HintValidator {
  private readonly MAX_RECIPE_STEPS = 20;
  private readonly MAX_DESCRIPTION_LENGTH = 200;
  private readonly BLOCKED_SELECTORS = ['html', 'body', '*', 'script'];
  private readonly PII_PATTERNS = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // Phone
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
    /\b(?:\d{4}[-\s]?){3}\d{4}\b/ // Credit card
  ];
  
  validateHint(hint: Partial<BrowserHint>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Required fields
    if (!hint.domain) errors.push('Domain is required');
    if (!hint.pattern_type) errors.push('Pattern type is required');
    if (!hint.recipe || !Array.isArray(hint.recipe)) errors.push('Recipe must be an array');
    if (!hint.description) errors.push('Description is required');
    
    // Validate domain
    if (hint.domain && !this.isValidDomain(hint.domain)) {
      errors.push('Invalid domain format');
    }
    
    // Validate recipe
    if (hint.recipe) {
      if (hint.recipe.length === 0) {
        errors.push('Recipe cannot be empty');
      }
      if (hint.recipe.length > this.MAX_RECIPE_STEPS) {
        errors.push(`Recipe cannot have more than ${this.MAX_RECIPE_STEPS} steps`);
      }
      
      for (const step of hint.recipe) {
        const stepErrors = this.validateToolCall(step);
        errors.push(...stepErrors);
      }
    }
    
    // Validate description
    if (hint.description && hint.description.length > this.MAX_DESCRIPTION_LENGTH) {
      errors.push(`Description cannot exceed ${this.MAX_DESCRIPTION_LENGTH} characters`);
    }
    
    // Check for PII
    if (hint.description && this.detectPII(hint.description)) {
      errors.push('Description contains potential PII');
    }
    
    // Validate selector
    if (hint.selector_guard && !this.isValidSelector(hint.selector_guard)) {
      errors.push('Invalid CSS selector');
    }
    
    // Check for blocked selectors
    if (hint.selector_guard && this.isBlockedSelector(hint.selector_guard)) {
      errors.push('Selector targets blocked element');
    }
    
    // Validate confidence
    if (hint.confidence !== undefined) {
      if (hint.confidence < 0 || hint.confidence > 1) {
        errors.push('Confidence must be between 0 and 1');
      }
    }
    
    // Warnings
    if (hint.recipe && hint.recipe.length > 10) {
      warnings.push('Recipe has many steps, consider simplifying');
    }
    
    if (!hint.selector_guard) {
      warnings.push('No selector guard specified, hint may apply incorrectly');
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  private validateToolCall(step: ToolCall): string[] {
    const errors: string[] = [];
    
    if (!step.tool) {
      errors.push('Tool call must specify tool name');
    }
    
    if (!step.args || typeof step.args !== 'object') {
      errors.push('Tool call must have args object');
    }
    
    // Check for sensitive data in args
    if (step.args) {
      const argsStr = JSON.stringify(step.args);
      if (this.detectPII(argsStr)) {
        errors.push('Tool args contain potential PII');
      }
      
      // Never store passwords
      if ('password' in step.args || 'secret' in step.args || 'token' in step.args) {
        errors.push('Tool args cannot contain passwords or secrets');
      }
    }
    
    // Validate wait_after
    if (step.wait_after !== undefined) {
      if (typeof step.wait_after !== 'number' || step.wait_after < 0 || step.wait_after > 30000) {
        errors.push('wait_after must be between 0 and 30000 ms');
      }
    }
    
    return errors;
  }
  
  sanitizeRecipe(recipe: ToolCall[]): ToolCall[] {
    return recipe.map(step => this.sanitizeToolCall(step));
  }
  
  private sanitizeToolCall(step: ToolCall): ToolCall {
    const sanitized: ToolCall = {
      tool: step.tool,
      args: { ...step.args }
    };
    
    // Remove sensitive fields
    const sensitiveFields = ['text', 'password', 'secret', 'token', 'apiKey', 'credential'];
    for (const field of sensitiveFields) {
      if (field in sanitized.args) {
        if (field === 'text') {
          // Keep text length for reference
          sanitized.args.text_length = sanitized.args[field]?.length;
        }
        delete sanitized.args[field];
      }
    }
    
    // Copy optional fields
    if (step.wait_after) sanitized.wait_after = step.wait_after;
    if (step.retry_on_failure) sanitized.retry_on_failure = step.retry_on_failure;
    if (step.fallback) sanitized.fallback = this.sanitizeToolCall(step.fallback);
    
    return sanitized;
  }
  
  detectPII(text: string): boolean {
    for (const pattern of this.PII_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }
  
  private isValidDomain(domain: string): boolean {
    try {
      new URL(`https://${domain}`);
      return true;
    } catch {
      return false;
    }
  }
  
  private isValidSelector(selector: string): boolean {
    try {
      // Basic validation - would need proper CSS parser for complete validation
      if (!selector || selector.trim().length === 0) return false;
      if (selector.includes('<') || selector.includes('>')) return false; // No HTML
      if (selector.includes('javascript:')) return false; // No JS
      return true;
    } catch {
      return false;
    }
  }
  
  private isBlockedSelector(selector: string): boolean {
    const normalized = selector.toLowerCase().trim();
    return this.BLOCKED_SELECTORS.some(blocked => 
      normalized === blocked || normalized.startsWith(blocked + ' ')
    );
  }
  
  assessHintQuality(hint: BrowserHint): QualityScore {
    let completeness = 1.0;
    let clarity = 1.0;
    let efficiency = 1.0;
    let safety = 1.0;
    
    // Completeness
    if (!hint.selector_guard) completeness -= 0.2;
    if (!hint.context) completeness -= 0.1;
    if (!hint.dom_fingerprint) completeness -= 0.1;
    if (hint.recipe.length < 2) completeness -= 0.2;
    
    // Clarity
    if (hint.description.length < 10) clarity -= 0.3;
    if (hint.description.length > 150) clarity -= 0.1;
    if (!hint.description.match(/[.!?]$/)) clarity -= 0.1; // No punctuation
    
    // Efficiency
    if (hint.recipe.length > 10) efficiency -= 0.3;
    if (hint.recipe.length > 15) efficiency -= 0.3;
    const totalWait = hint.recipe.reduce((sum, step) => sum + (step.wait_after || 0), 0);
    if (totalWait > 10000) efficiency -= 0.2;
    
    // Safety
    if (this.detectPII(hint.description)) safety = 0;
    if (hint.recipe.some(step => this.detectPII(JSON.stringify(step.args)))) safety -= 0.5;
    if (!hint.selector_guard) safety -= 0.2;
    
    const score = (completeness + clarity + efficiency + safety) / 4;
    
    return {
      score: Math.max(0, Math.min(1, score)),
      factors: {
        completeness: Math.max(0, completeness),
        clarity: Math.max(0, clarity),
        efficiency: Math.max(0, efficiency),
        safety: Math.max(0, safety)
      }
    };
  }
  
  detectDuplicates(hint: BrowserHint, existing: BrowserHint[]): boolean {
    for (const other of existing) {
      // Same domain and selector
      if (hint.domain === other.domain && 
          hint.selector_guard === other.selector_guard &&
          hint.pattern_type === other.pattern_type) {
        return true;
      }
      
      // Same recipe (simplified comparison)
      if (JSON.stringify(hint.recipe) === JSON.stringify(other.recipe)) {
        return true;
      }
    }
    
    return false;
  }
}