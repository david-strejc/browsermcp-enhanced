/**
 * BrowserMCP Multitool - Meta-tool for orchestrating common browser automation patterns
 * 
 * This tool wraps existing browser primitives into high-level, reusable patterns
 * for common automation scenarios like form filling, login flows, search operations, etc.
 */

import { z } from 'zod';

// Pattern execution context
export interface MultitoolContext {
  snapshot?: any;
  lastError?: Error;
  retryCount: number;
  maxRetries: number;
  params: Record<string, any>;
  results: Record<string, any>;
  confidence: number;
}

// Base pattern interface
export interface Pattern {
  name: string;
  description: string;
  requiredParams?: string[];
  optionalParams?: string[];
  
  // Check if this pattern can handle the current context
  canHandle(context: MultitoolContext): Promise<boolean>;
  
  // Execute the pattern
  execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown>;
  
  // Recover from errors
  recover(error: Error, context: MultitoolContext): Promise<boolean>;
}

export interface PatternStep {
  action: string;
  params?: Record<string, any>;
  description?: string;
  optional?: boolean;
}

export interface PatternResult {
  success: boolean;
  pattern: string;
  data?: any;
  error?: string;
  steps?: number;
  duration?: number;
}

// Field detection utilities
export class FieldDetector {
  // Common field name synonyms
  private static synonyms = {
    username: ['user', 'username', 'login', 'email', 'userid', 'account'],
    password: ['pass', 'password', 'pwd', 'passwd', 'secret'],
    email: ['email', 'mail', 'e-mail', 'emailaddress'],
    name: ['name', 'fullname', 'full-name', 'firstname', 'first-name'],
    search: ['search', 'query', 'q', 'find', 'keyword', 'term'],
    submit: ['submit', 'send', 'go', 'search', 'login', 'signin', 'enter'],
  };

  static findField(snapshot: any, fieldType: string): string | null {
    const possibleNames = this.synonyms[fieldType] || [fieldType];
    
    // Try different strategies
    for (const name of possibleNames) {
      // By ID
      const byId = snapshot.elements?.find((el: any) => 
        el.attributes?.id?.toLowerCase().includes(name.toLowerCase())
      );
      if (byId) return byId.ref;
      
      // By name attribute
      const byName = snapshot.elements?.find((el: any) => 
        el.attributes?.name?.toLowerCase().includes(name.toLowerCase())
      );
      if (byName) return byName.ref;
      
      // By placeholder
      const byPlaceholder = snapshot.elements?.find((el: any) => 
        el.attributes?.placeholder?.toLowerCase().includes(name.toLowerCase())
      );
      if (byPlaceholder) return byPlaceholder.ref;
      
      // By aria-label
      const byAria = snapshot.elements?.find((el: any) => 
        el.attributes?.['aria-label']?.toLowerCase().includes(name.toLowerCase())
      );
      if (byAria) return byAria.ref;
    }
    
    return null;
  }

  static detectFormType(snapshot: any): 'login' | 'search' | 'registration' | 'generic' | null {
    const hasPassword = !!this.findField(snapshot, 'password');
    const hasSearch = !!this.findField(snapshot, 'search');
    const hasEmail = !!this.findField(snapshot, 'email');
    const hasName = !!this.findField(snapshot, 'name');
    
    if (hasPassword && (hasEmail || this.findField(snapshot, 'username'))) {
      return 'login';
    }
    if (hasSearch) {
      return 'search';
    }
    if (hasEmail && hasName && !hasPassword) {
      return 'registration';
    }
    if (snapshot.elements?.some((el: any) => el.tag === 'form')) {
      return 'generic';
    }
    
    return null;
  }
}

// Form Fill Pattern
export class FormFillPattern implements Pattern {
  name = 'form_fill';
  description = 'Fills and submits a form with provided data';
  requiredParams = ['fields'];
  optionalParams = ['submitButton', 'waitAfterSubmit'];

  async canHandle(context: MultitoolContext): Promise<boolean> {
    if (context.params.pattern === this.name) return true;
    if (!context.params.fields) return false;
    
    // Check if there's a form on the page
    const formType = FieldDetector.detectFormType(context.snapshot);
    return formType !== null;
  }

  async *execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown> {
    const startTime = Date.now();
    let stepCount = 0;

    try {
      // Get fresh snapshot
      yield {
        action: 'browser_snapshot',
        params: { level: 'minimal' },
        description: 'Getting page structure'
      };
      stepCount++;

      // Fill each field
      const fields = context.params.fields as Record<string, string>;
      for (const [fieldName, value] of Object.entries(fields)) {
        const fieldRef = FieldDetector.findField(context.snapshot, fieldName);
        
        if (!fieldRef) {
          if (!context.params.skipMissingFields) {
            throw new Error(`Field not found: ${fieldName}`);
          }
          continue;
        }

        yield {
          action: 'browser_type',
          params: {
            ref: fieldRef,
            element: `${fieldName} field`,
            text: value,
            submit: false
          },
          description: `Filling ${fieldName}`
        };
        stepCount++;

        // Small delay between fields to appear more human-like
        yield {
          action: 'browser_wait',
          params: { time: 0.2 },
          optional: true
        };
      }

      // Find and click submit button
      let submitRef = context.params.submitButton;
      if (!submitRef) {
        // Auto-detect submit button
        submitRef = FieldDetector.findField(context.snapshot, 'submit');
      }

      if (submitRef) {
        yield {
          action: 'browser_click',
          params: {
            ref: submitRef,
            element: 'submit button'
          },
          description: 'Submitting form'
        };
        stepCount++;

        if (context.params.waitAfterSubmit) {
          yield {
            action: 'browser_wait',
            params: { time: context.params.waitAfterSubmit },
            description: 'Waiting for form submission'
          };
        }
      }

      return {
        success: true,
        pattern: this.name,
        steps: stepCount,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        pattern: this.name,
        error: error.message,
        steps: stepCount,
        duration: Date.now() - startTime
      };
    }
  }

  async recover(error: Error, context: MultitoolContext): Promise<boolean> {
    // Try alternative selectors or wait longer
    if (error.message.includes('not found') && context.retryCount < context.maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return true; // Retry
    }
    return false;
  }
}

// Login Pattern
export class LoginPattern implements Pattern {
  name = 'login';
  description = 'Performs a login flow with username/email and password';
  requiredParams = ['username', 'password'];
  optionalParams = ['rememberMe', 'captchaHandler'];

  async canHandle(context: MultitoolContext): Promise<boolean> {
    if (context.params.pattern === this.name) return true;
    if (!context.params.username || !context.params.password) return false;
    
    const formType = FieldDetector.detectFormType(context.snapshot);
    return formType === 'login';
  }

  async *execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown> {
    const startTime = Date.now();
    let stepCount = 0;

    try {
      // Snapshot to understand the page
      yield {
        action: 'browser_snapshot',
        params: { level: 'minimal' },
        description: 'Analyzing login form'
      };
      stepCount++;

      // Check for cookie banner and dismiss
      yield {
        action: 'browser_common_operation',
        params: { operation: 'hide_popups' },
        description: 'Dismissing popups',
        optional: true
      };

      // Find username field
      const usernameRef = FieldDetector.findField(context.snapshot, 'username') ||
                         FieldDetector.findField(context.snapshot, 'email');
      
      if (!usernameRef) {
        throw new Error('Username/email field not found');
      }

      // Type username
      yield {
        action: 'browser_type',
        params: {
          ref: usernameRef,
          element: 'username field',
          text: context.params.username,
          submit: false
        },
        description: 'Entering username'
      };
      stepCount++;

      // Find password field
      const passwordRef = FieldDetector.findField(context.snapshot, 'password');
      
      if (!passwordRef) {
        throw new Error('Password field not found');
      }

      // Type password
      yield {
        action: 'browser_type',
        params: {
          ref: passwordRef,
          element: 'password field',
          text: context.params.password,
          submit: false
        },
        description: 'Entering password'
      };
      stepCount++;

      // Handle remember me checkbox if requested
      if (context.params.rememberMe) {
        const rememberRef = context.snapshot.elements?.find((el: any) => 
          el.type === 'checkbox' && 
          (el.text?.toLowerCase().includes('remember') || 
           el.attributes?.name?.includes('remember'))
        )?.ref;

        if (rememberRef) {
          yield {
            action: 'browser_click',
            params: {
              ref: rememberRef,
              element: 'remember me checkbox'
            },
            description: 'Checking remember me',
            optional: true
          };
          stepCount++;
        }
      }

      // Check for CAPTCHA
      const hasCaptcha = context.snapshot.elements?.some((el: any) => 
        el.className?.includes('captcha') || 
        el.attributes?.src?.includes('captcha')
      );

      if (hasCaptcha) {
        if (context.params.captchaHandler) {
          // Call custom captcha handler
          yield {
            action: 'custom_captcha',
            params: { handler: context.params.captchaHandler },
            description: 'Handling CAPTCHA'
          };
        } else {
          throw new Error('CAPTCHA detected but no handler provided');
        }
      }

      // Find and click submit button
      const submitRef = FieldDetector.findField(context.snapshot, 'submit') ||
                       context.snapshot.elements?.find((el: any) => 
                         el.tag === 'button' && el.type === 'submit'
                       )?.ref;

      if (!submitRef) {
        // Try pressing Enter instead
        yield {
          action: 'browser_press_key',
          params: { key: 'Enter' },
          description: 'Pressing Enter to submit'
        };
      } else {
        yield {
          action: 'browser_click',
          params: {
            ref: submitRef,
            element: 'login button'
          },
          description: 'Clicking login button'
        };
      }
      stepCount++;

      // Wait for navigation
      yield {
        action: 'browser_wait',
        params: { time: 2 },
        description: 'Waiting for login to complete'
      };

      // Check if login was successful (look for logout button or user menu)
      yield {
        action: 'browser_snapshot',
        params: { level: 'minimal' },
        description: 'Verifying login success'
      };
      stepCount++;

      const hasLogout = context.snapshot.elements?.some((el: any) => 
        el.text?.toLowerCase().includes('logout') ||
        el.text?.toLowerCase().includes('sign out')
      );

      return {
        success: hasLogout,
        pattern: this.name,
        data: { loggedIn: hasLogout },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        pattern: this.name,
        error: error.message,
        steps: stepCount,
        duration: Date.now() - startTime
      };
    }
  }

  async recover(error: Error, context: MultitoolContext): Promise<boolean> {
    if (error.message.includes('CAPTCHA')) {
      // Could implement fallback CAPTCHA solving
      return false;
    }
    if (context.retryCount < 2) {
      // Wait and retry for temporary issues
      await new Promise(resolve => setTimeout(resolve, 2000));
      return true;
    }
    return false;
  }
}

// Search Pattern
export class SearchPattern implements Pattern {
  name = 'search';
  description = 'Performs a search operation and waits for results';
  requiredParams = ['query'];
  optionalParams = ['searchField', 'waitForResults', 'resultSelector'];

  async canHandle(context: MultitoolContext): Promise<boolean> {
    if (context.params.pattern === this.name) return true;
    if (!context.params.query) return false;
    
    const hasSearchField = FieldDetector.findField(context.snapshot, 'search');
    return hasSearchField !== null;
  }

  async *execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown> {
    const startTime = Date.now();
    let stepCount = 0;

    try {
      // Get snapshot
      yield {
        action: 'browser_snapshot',
        params: { level: 'minimal' },
        description: 'Finding search field'
      };
      stepCount++;

      // Find search field
      const searchRef = context.params.searchField || 
                       FieldDetector.findField(context.snapshot, 'search');
      
      if (!searchRef) {
        throw new Error('Search field not found');
      }

      // Clear existing text if any
      yield {
        action: 'browser_execute_js',
        params: {
          code: `api.$('${searchRef}').value = '';`,
          unsafe: false
        },
        description: 'Clearing search field',
        optional: true
      };

      // Type search query
      yield {
        action: 'browser_type',
        params: {
          ref: searchRef,
          element: 'search field',
          text: context.params.query,
          submit: true // Auto-submit for search
        },
        description: `Searching for: ${context.params.query}`
      };
      stepCount++;

      // Wait for results to load
      const waitTime = context.params.waitForResults || 2;
      yield {
        action: 'browser_wait',
        params: { time: waitTime },
        description: 'Waiting for search results'
      };

      // Get results snapshot
      yield {
        action: 'browser_snapshot',
        params: { level: 'minimal' },
        description: 'Capturing search results'
      };
      stepCount++;

      // Count results if selector provided
      let resultCount = 0;
      if (context.params.resultSelector) {
        const results = context.snapshot.elements?.filter((el: any) => 
          el.selector === context.params.resultSelector
        );
        resultCount = results?.length || 0;
      }

      return {
        success: true,
        pattern: this.name,
        data: { 
          query: context.params.query,
          resultCount 
        },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        pattern: this.name,
        error: error.message,
        steps: stepCount,
        duration: Date.now() - startTime
      };
    }
  }

  async recover(error: Error, context: MultitoolContext): Promise<boolean> {
    // Try alternative search methods
    if (error.message.includes('not found')) {
      // Could try Ctrl+F browser search as fallback
      return false;
    }
    return false;
  }
}

// Navigation Sequence Pattern
export class NavigationSequencePattern implements Pattern {
  name = 'navigation_sequence';
  description = 'Navigates through a sequence of pages or actions';
  requiredParams = ['steps'];
  optionalParams = ['waitBetween', 'stopOnError'];

  async canHandle(context: MultitoolContext): Promise<boolean> {
    if (context.params.pattern === this.name) return true;
    return Array.isArray(context.params.steps);
  }

  async *execute(context: MultitoolContext): AsyncGenerator<PatternStep, PatternResult, unknown> {
    const startTime = Date.now();
    let stepCount = 0;
    const results: any[] = [];

    try {
      const steps = context.params.steps as any[];
      const waitBetween = context.params.waitBetween || 1;

      for (const step of steps) {
        // Execute each navigation step
        if (step.type === 'click') {
          yield {
            action: 'browser_click',
            params: {
              ref: step.ref,
              element: step.element || 'element'
            },
            description: step.description
          };
        } else if (step.type === 'navigate') {
          yield {
            action: 'browser_navigate',
            params: { url: step.url },
            description: `Navigating to ${step.url}`
          };
        } else if (step.type === 'back') {
          yield {
            action: 'browser_go_back',
            params: {},
            description: 'Going back'
          };
        } else if (step.type === 'wait') {
          yield {
            action: 'browser_wait',
            params: { time: step.duration || 1 },
            description: 'Waiting'
          };
        }
        
        stepCount++;
        results.push({ step: stepCount, type: step.type, success: true });

        // Wait between steps
        if (waitBetween > 0 && stepCount < steps.length) {
          yield {
            action: 'browser_wait',
            params: { time: waitBetween },
            optional: true
          };
        }
      }

      return {
        success: true,
        pattern: this.name,
        data: { completedSteps: results },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        pattern: this.name,
        error: error.message,
        data: { completedSteps: results },
        steps: stepCount,
        duration: Date.now() - startTime
      };
    }
  }

  async recover(error: Error, context: MultitoolContext): Promise<boolean> {
    if (context.params.stopOnError === false && context.retryCount < 1) {
      // Skip failed step and continue
      return true;
    }
    return false;
  }
}

// Pattern Registry
export class PatternRegistry {
  private patterns: Map<string, Pattern> = new Map();

  constructor() {
    // Register default patterns
    this.register(new FormFillPattern());
    this.register(new LoginPattern());
    this.register(new SearchPattern());
    this.register(new NavigationSequencePattern());
  }

  register(pattern: Pattern): void {
    this.patterns.set(pattern.name, pattern);
  }

  get(name: string): Pattern | undefined {
    return this.patterns.get(name);
  }

  async findMatch(context: MultitoolContext): Promise<Pattern | null> {
    // If pattern explicitly specified, use it
    if (context.params.pattern) {
      return this.get(context.params.pattern) || null;
    }

    // Otherwise, find first pattern that can handle
    for (const pattern of this.patterns.values()) {
      if (await pattern.canHandle(context)) {
        return pattern;
      }
    }

    return null;
  }

  list(): Array<{ name: string; description: string }> {
    return Array.from(this.patterns.values()).map(p => ({
      name: p.name,
      description: p.description
    }));
  }
}

// Main Multitool class
export class BrowserMultitool {
  private registry: PatternRegistry;

  constructor() {
    this.registry = new PatternRegistry();
  }

  async execute(params: Record<string, any>): Promise<PatternResult> {
    const context: MultitoolContext = {
      params,
      retryCount: 0,
      maxRetries: params.maxRetries || 3,
      results: {},
      confidence: 1.0
    };

    // Find matching pattern
    const pattern = await this.registry.findMatch(context);
    if (!pattern) {
      return {
        success: false,
        pattern: 'unknown',
        error: 'No matching pattern found for the given parameters'
      };
    }

    // Execute pattern with retry logic
    let lastError: Error | null = null;
    
    while (context.retryCount <= context.maxRetries) {
      try {
        // Execute pattern generator
        const generator = pattern.execute(context);
        let stepResult = await generator.next();
        
        while (!stepResult.done) {
          // Here you would actually execute the browser action
          // For now, just track the step
          console.log('Executing:', stepResult.value);
          stepResult = await generator.next();
        }
        
        return stepResult.value;
      } catch (error) {
        lastError = error as Error;
        context.lastError = lastError;
        
        // Try to recover
        const canRecover = await pattern.recover(lastError, context);
        if (!canRecover) {
          break;
        }
        
        context.retryCount++;
      }
    }

    return {
      success: false,
      pattern: pattern.name,
      error: lastError?.message || 'Unknown error'
    };
  }

  // Get available patterns
  getPatterns(): Array<{ name: string; description: string }> {
    return this.registry.list();
  }

  // Register custom pattern
  registerPattern(pattern: Pattern): void {
    this.registry.register(pattern);
  }
}

// Export schemas for MCP tool definition
export const MultitoolParamsSchema = z.object({
  pattern: z.string().optional().describe('Specific pattern to use'),
  
  // Form/Login params
  fields: z.record(z.string()).optional().describe('Field name to value mapping'),
  username: z.string().optional().describe('Username or email for login'),
  password: z.string().optional().describe('Password for login'),
  rememberMe: z.boolean().optional().describe('Check remember me box'),
  
  // Search params
  query: z.string().optional().describe('Search query'),
  searchField: z.string().optional().describe('Specific search field selector'),
  
  // Navigation params
  steps: z.array(z.object({
    type: z.enum(['click', 'navigate', 'back', 'wait']),
    ref: z.string().optional(),
    url: z.string().optional(),
    element: z.string().optional(),
    duration: z.number().optional()
  })).optional().describe('Navigation steps to execute'),
  
  // General params
  waitBetween: z.number().optional().describe('Wait time between steps'),
  maxRetries: z.number().optional().describe('Maximum retry attempts'),
  skipMissingFields: z.boolean().optional().describe('Skip fields that cannot be found'),
  stopOnError: z.boolean().optional().describe('Stop sequence on first error')
});

export type MultitoolParams = z.infer<typeof MultitoolParamsSchema>;