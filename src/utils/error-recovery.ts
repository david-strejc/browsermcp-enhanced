import { BrowserMCPError } from "../messaging/ws/sender";
import type { ToolResult } from "../tools/tool";

// Recovery suggestion interface
interface RecoverySuggestion {
  action: string;
  description: string;
  code?: string;
}

// Enhanced error result with recovery suggestions
export interface ErrorResult extends ToolResult {
  isError: true;
  code?: string;
  retryable?: boolean;
  suggestions?: RecoverySuggestion[];
}

// Error recovery utility class
export class ErrorRecovery {
  static handleToolError(
    error: Error,
    toolName: string,
    context?: string
  ): ErrorResult {
    if (error instanceof BrowserMCPError) {
      return this.handleBrowserMCPError(error, toolName, context);
    }
    
    return this.handleGenericError(error, toolName, context);
  }
  
  private static handleBrowserMCPError(
    error: BrowserMCPError,
    toolName: string,
    context?: string
  ): ErrorResult {
    const suggestions = this.generateRecoverySuggestions(error, toolName);
    const contextStr = context ? ` (${context})` : '';
    
    return {
      content: [
        {
          type: "text",
          text: this.formatErrorMessage(error, toolName, contextStr, suggestions),
        },
      ],
      isError: true,
      code: error.code,
      retryable: error.retryable,
      suggestions,
    };
  }
  
  private static handleGenericError(
    error: Error,
    toolName: string,
    context?: string
  ): ErrorResult {
    const contextStr = context ? ` (${context})` : '';
    const suggestions = this.generateGenericSuggestions(error, toolName);
    
    return {
      content: [
        {
          type: "text",
          text: this.formatGenericErrorMessage(error, toolName, contextStr, suggestions),
        },
      ],
      isError: true,
      code: 'GENERIC_ERROR',
      retryable: true,
      suggestions,
    };
  }
  
  private static generateRecoverySuggestions(
    error: BrowserMCPError,
    toolName: string
  ): RecoverySuggestion[] {
    const suggestions: RecoverySuggestion[] = [];
    
    switch (error.code) {
      case 'NO_CONNECTION':
      case 'CONNECTION_CLOSED':
        suggestions.push(
          {
            action: "Check Extension",
            description: "Verify the BrowserMCP extension is installed and enabled in Chrome"
          },
          {
            action: "Connect Tab",
            description: "Click the extension icon and press 'Connect' button in the active tab"
          },
          {
            action: "Restart Extension",
            description: "Disable and re-enable the extension in chrome://extensions"
          }
        );
        break;
        
      case 'MESSAGE_TIMEOUT':
        suggestions.push(
          {
            action: "Retry Operation",
            description: "The browser may be busy - try the operation again"
          },
          {
            action: "Refresh Page",
            description: "Navigate to a fresh page if the current page is unresponsive",
            code: `browser_navigate({ url: "${getCurrentUrl()}" })`
          },
          {
            action: "Check Page Load",
            description: "Ensure the page has finished loading before attempting operations"
          }
        );
        break;
        
      case 'EXTENSION_ERROR':
        if (error.message.includes('invalid.*reference')) {
          suggestions.push(
            {
              action: "Get New Snapshot",
              description: "Element references may be stale - capture a fresh page snapshot",
              code: "browser_snapshot()"
            },
            {
              action: "Find Element",
              description: "Use browser_execute_js to find the element by text or selector",
              code: "browser_execute_js({ code: \"return await api.exists('button')\" })"
            }
          );
        } else if (error.message.includes('element.*not.*found')) {
          suggestions.push(
            {
              action: "Verify Element Exists",
              description: "Check if the element is visible and accessible on the page"
            },
            {
              action: "Wait for Element",
              description: "Element might not be loaded yet - wait a moment and try again",
              code: "browser_wait({ time: 2 })"
            },
            {
              action: "Check Page Content",
              description: "Take a screenshot to verify current page state",
              code: "browser_screenshot()"
            }
          );
        }
        break;
        
      case 'WEBSOCKET_ERROR':
      case 'SEND_ERROR':
        suggestions.push(
          {
            action: "Check Network",
            description: "Verify network connectivity between server and extension"
          },
          {
            action: "Restart Server",
            description: "Restart the MCP server if connection issues persist"
          }
        );
        break;
        
      case 'MAX_RETRIES_EXCEEDED':
        suggestions.push(
          {
            action: "Manual Inspection",
            description: "Take a screenshot to see current page state",
            code: "browser_screenshot()"
          },
          {
            action: "Simplify Operation",
            description: "Try breaking down the operation into smaller steps"
          },
          {
            action: "Change Approach",
            description: "Consider using alternative tools or methods for this task"
          }
        );
        break;
    }
    
    // Add tool-specific suggestions
    suggestions.push(...this.getToolSpecificSuggestions(toolName, error));
    
    return suggestions;
  }
  
  private static getToolSpecificSuggestions(
    toolName: string,
    error: BrowserMCPError
  ): RecoverySuggestion[] {
    const suggestions: RecoverySuggestion[] = [];
    
    switch (toolName) {
      case 'browser_click':
        suggestions.push({
          action: "Verify Element is Clickable",
          description: "Ensure the element is visible and not covered by other elements"
        });
        break;
        
      case 'browser_type':
        suggestions.push({
          action: "Check Input Field",
          description: "Verify the input field is enabled and focused"
        });
        break;
        
      case 'browser_navigate':
        suggestions.push({
          action: "Check URL",
          description: "Verify the URL is valid and accessible"
        });
        break;
        
      case 'browser_execute_js':
        if (error.message.includes('unsafe')) {
          suggestions.push({
            action: "Enable Unsafe Mode",
            description: "Set BROWSERMCP_UNSAFE_MODE=true or enable in extension options"
          });
        }
        break;
    }
    
    return suggestions;
  }
  
  private static generateGenericSuggestions(
    error: Error,
    toolName: string
  ): RecoverySuggestion[] {
    return [
      {
        action: "Check Error Details",
        description: "Review the full error message for specific guidance"
      },
      {
        action: "Take Screenshot",
        description: "Capture current page state for debugging",
        code: "browser_screenshot()"
      },
      {
        action: "Try Again",
        description: "Some errors are transient - try the operation again"
      }
    ];
  }
  
  private static formatErrorMessage(
    error: BrowserMCPError,
    toolName: string,
    context: string,
    suggestions: RecoverySuggestion[]
  ): string {
    let message = `❌ ${toolName} failed${context}: ${error.message}`;
    
    if (error.retryable) {
      message += "\n\n🔄 This error is retryable - the system will automatically retry on temporary failures.";
    }
    
    if (error.details) {
      message += `\n\n📊 Error Details:\n${JSON.stringify(error.details, null, 2)}`;
    }
    
    if (suggestions.length > 0) {
      message += `\n\n💡 Recovery Suggestions:`;
      suggestions.forEach((suggestion, index) => {
        message += `\n${index + 1}. **${suggestion.action}**: ${suggestion.description}`;
        if (suggestion.code) {
          message += `\n   Code: \`${suggestion.code}\``;
        }
      });
    }
    
    return message;
  }
  
  private static formatGenericErrorMessage(
    error: Error,
    toolName: string,
    context: string,
    suggestions: RecoverySuggestion[]
  ): string {
    let message = `❌ ${toolName} failed${context}: ${error.message}`;
    
    if (suggestions.length > 0) {
      message += `\n\n💡 Suggestions:`;
      suggestions.forEach((suggestion, index) => {
        message += `\n${index + 1}. **${suggestion.action}**: ${suggestion.description}`;
        if (suggestion.code) {
          message += `\n   Code: \`${suggestion.code}\``;
        }
      });
    }
    
    return message;
  }
}

// Utility function to get current URL (placeholder - would need real implementation)
function getCurrentUrl(): string {
  return "about:blank"; // This would be replaced with actual current URL logic
}

// Export for use in tools
export { BrowserMCPError };