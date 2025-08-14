import { createHash } from 'crypto';

export interface Viewport {
  width: number;
  height: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  userRole?: string;
}

export class HintMatcher {
  /**
   * Match URL against a pattern with wildcards
   * Supports:
   * - Exact match: /login
   * - Wildcard suffix: /admin/* (matches any path under admin)
   * - Path parameters: /user/[id]/profile (where [id] can be any segment)
   */
  matchUrl(url: string, pattern: string): boolean {
    // Exact match
    if (url === pattern) return true;
    
    // Parse URLs
    let urlPath: string;
    let patternPath: string;
    
    try {
      urlPath = new URL(url).pathname;
      
      // Pattern might be just a path or full URL
      if (pattern.startsWith('http')) {
        patternPath = new URL(pattern).pathname;
      } else {
        patternPath = pattern;
      }
    } catch {
      // If parsing fails, do simple string comparison
      return url === pattern;
    }
    
    // Convert pattern to regex
    const regexPattern = patternPath
      .split('/')
      .map(segment => {
        if (segment === '*') return '[^/]+'; // Match any single segment
        if (segment === '**') return '.*'; // Match any path
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special chars
      })
      .join('/');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(urlPath);
  }
  
  /**
   * Validate that a CSS selector exists in the DOM
   * For MVP, we just validate selector syntax
   */
  validateSelector(dom: Document | string, selector: string): boolean {
    // Basic syntax validation
    if (!selector || selector.trim().length === 0) return false;
    
    // If we have actual DOM (future enhancement)
    if (typeof dom === 'object' && dom.querySelector) {
      try {
        return dom.querySelector(selector) !== null;
      } catch {
        return false;
      }
    }
    
    // For string DOM or when we can't validate
    // Just check if selector looks valid
    return this.isValidCSSSelector(selector);
  }
  
  /**
   * Extract a fingerprint from DOM structure
   * Creates a hash of important structural elements
   */
  extractDomFingerprint(dom: Document | string): string {
    const features: string[] = [];
    
    if (typeof dom === 'string') {
      // Extract features from HTML string
      // Count important tags
      const formCount = (dom.match(/<form/gi) || []).length;
      const inputCount = (dom.match(/<input/gi) || []).length;
      const buttonCount = (dom.match(/<button/gi) || []).length;
      
      features.push(`forms:${formCount}`);
      features.push(`inputs:${inputCount}`);
      features.push(`buttons:${buttonCount}`);
      
      // Look for common auth elements
      if (dom.includes('password') || dom.includes('Password')) {
        features.push('has:password');
      }
      if (dom.includes('email') || dom.includes('Email')) {
        features.push('has:email');
      }
      if (dom.includes('login') || dom.includes('Login')) {
        features.push('has:login');
      }
    } else if (dom && dom.querySelectorAll) {
      // Real DOM
      features.push(`forms:${dom.querySelectorAll('form').length}`);
      features.push(`inputs:${dom.querySelectorAll('input').length}`);
      features.push(`buttons:${dom.querySelectorAll('button').length}`);
      
      // Check for specific input types
      if (dom.querySelector('input[type="password"]')) {
        features.push('has:password');
      }
      if (dom.querySelector('input[type="email"]')) {
        features.push('has:email');
      }
    }
    
    // Create hash from features
    const fingerprint = features.sort().join('|');
    return createHash('sha1').update(fingerprint).digest('hex').substring(0, 16);
  }
  
  /**
   * Compare two DOM fingerprints and return similarity score (0-1)
   */
  compareDomFingerprints(fp1: string, fp2: string): number {
    if (fp1 === fp2) return 1.0;
    
    // Simple comparison - could be enhanced with fuzzy matching
    const len = Math.min(fp1.length, fp2.length);
    let matches = 0;
    
    for (let i = 0; i < len; i++) {
      if (fp1[i] === fp2[i]) matches++;
    }
    
    return matches / len;
  }
  
  /**
   * Check if current viewport matches required viewport
   */
  matchViewport(current: Viewport, required: Viewport): boolean {
    return current.width >= required.width && current.height >= required.height;
  }
  
  /**
   * Check if current auth state matches required auth state
   */
  matchAuthState(current: AuthState, required: AuthState): boolean {
    if (required.isAuthenticated && !current.isAuthenticated) {
      return false;
    }
    
    if (required.userRole && current.userRole !== required.userRole) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Basic CSS selector validation
   */
  private isValidCSSSelector(selector: string): boolean {
    // Check for obviously invalid patterns
    const invalid = [
      /^[0-9]/, // Starts with number
      /\s$/, // Ends with space
      /^[>~+]/, // Starts with combinator
      /:$/, // Ends with colon
      /\[.*\]$/, // Ends with attribute selector without element
    ];
    
    for (const pattern of invalid) {
      if (pattern.test(selector)) return false;
    }
    
    // Check for balanced brackets and quotes
    let brackets = 0;
    let singleQuotes = 0;
    let doubleQuotes = 0;
    
    for (const char of selector) {
      if (char === '[') brackets++;
      if (char === ']') brackets--;
      if (char === "'") singleQuotes++;
      if (char === '"') doubleQuotes++;
      
      if (brackets < 0) return false; // Closing bracket before opening
    }
    
    return brackets === 0 && singleQuotes % 2 === 0 && doubleQuotes % 2 === 0;
  }
}