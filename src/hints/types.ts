export type PatternType = 
  | 'login'           // Username/password authentication
  | 'form_fill'       // Generic form submission
  | 'navigation'      // Multi-step navigation
  | 'interaction'     // Click/hover interactions
  | 'wait'            // Wait conditions
  | 'modal'           // Modal/popup handling
  | 'dynamic'         // JavaScript-rendered content
  | 'search'          // Search interactions
  | 'upload'          // File upload patterns
  | 'pagination';     // Pagination navigation

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
  wait_after?: number;
  retry_on_failure?: boolean;
  fallback?: ToolCall;
}

export interface BrowserHint {
  // Identity
  id: string;
  domain: string;
  path_pattern?: string;
  url_hash: string;
  
  // Classification
  pattern_type: PatternType;
  selector_guard?: string;
  dom_fingerprint?: string;
  
  // Solution
  recipe: ToolCall[];
  description: string;
  
  // Context requirements
  context?: {
    viewport_min?: { width: number; height: number };
    requires_auth?: boolean;
    locale?: string;
    user_agent_pattern?: string;
  };
  
  // Authority
  success_count: number;
  failure_count: number;
  confidence: number;
  
  // Metadata
  author_id: string;
  created_at: number;
  last_used_at?: number;
  last_success_at?: number;
  version: number;
  is_active: boolean;
  
  // Relationships
  parent_hint_id?: string;
  related_hints?: string[];
}

export interface HintStats {
  total_hints: number;
  success_rate: number;
  top_patterns: Array<{ pattern_type: PatternType; count: number }>;
  recent_failures: BrowserHint[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface QualityScore {
  score: number; // 0-1
  factors: {
    completeness: number;
    clarity: number;
    efficiency: number;
    safety: number;
  };
}