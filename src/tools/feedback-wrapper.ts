/**
 * Feedback Wrapper - Integrates feedback system with tools
 * Wraps tool execution to collect and return feedback
 */

import type { Context } from "../context";
import type { Tool, ToolResult } from "./tool";
import { ActionFeedback, RawFeedbackBundle } from "../types/feedback";
import { feedbackSummarizer } from "../feedback/summarizer";

export interface EnhancedToolResult extends ToolResult {
  feedback?: ActionFeedback;
}

/**
 * Wrap a tool to automatically collect feedback
 */
export function withFeedback(tool: Tool): Tool {
  const originalHandle = tool.handle;

  tool.handle = async (context: Context, params: any): Promise<ToolResult> => {
    const startTime = Date.now();
    let feedbackBundle: RawFeedbackBundle | null = null;
    let success = false;
    let error: string | undefined;
    let result: ToolResult;

    try {
      // Start feedback collection in extension
      if (params?.ref || params?.element) {
        await context.sendSocketMessage("feedback.start", {
          action: tool.schema.name,
          ref: params.ref,
          element: params.element
        });
      }

      // Execute original tool
      result = await originalHandle(context, params);
      success = !result.isError;

      // Stop feedback collection and get bundle
      try {
        feedbackBundle = await context.sendSocketMessage("feedback.stop", {});
      } catch (fbError) {
        console.warn("Failed to collect feedback:", fbError);
      }

    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      result = {
        content: [
          {
            type: "text",
            text: `❌ ${tool.schema.name} failed: ${error}`
          }
        ],
        isError: true
      };
    }

    // Generate feedback if we have a bundle
    if (feedbackBundle) {
      const feedback = feedbackSummarizer.summarize(
        tool.schema.name,
        params?.ref,
        feedbackBundle,
        success,
        error
      );

      // Add feedback to result
      const enhancedResult = result as EnhancedToolResult;
      enhancedResult.feedback = feedback;

      // Append feedback hint to text content if failed
      if (!success && feedback.hint) {
        const textContent = result.content.find(c => c.type === "text");
        if (textContent && 'text' in textContent) {
          textContent.text += `\n\n💡 ${feedback.hint}`;
        }
      }

      // Add formatted feedback for debugging (only in dev mode)
      if (process.env.NODE_ENV === 'development') {
        const formatted = feedbackSummarizer.formatForDisplay(feedback);
        console.log(`[Feedback] ${formatted}`);
      }
    }

    return result;
  };

  return tool;
}

/**
 * Create a feedback-aware tool wrapper
 */
export function createFeedbackTool(
  name: string,
  description: string,
  execute: (context: Context, params: any) => Promise<any>
): Tool {
  const baseTool: Tool = {
    schema: {
      name,
      description,
      inputSchema: {} // Will be defined by specific tool
    },
    handle: async (context: Context, params: any) => {
      const result = await execute(context, params);
      
      // Ensure result is properly formatted
      if (!result.content) {
        return {
          content: [
            {
              type: "text",
              text: String(result)
            }
          ]
        };
      }
      
      return result;
    }
  };

  return withFeedback(baseTool);
}

/**
 * Extract feedback from tool result for analysis
 */
export function extractFeedback(result: ToolResult): ActionFeedback | undefined {
  return (result as EnhancedToolResult).feedback;
}

/**
 * Format feedback as compact text for AI
 */
export function formatFeedbackCompact(feedback: ActionFeedback): string {
  const parts: string[] = [];
  
  // Status indicator
  parts.push(feedback.ok ? '✓' : '✗');
  
  // Action and code
  parts.push(`${feedback.act}[${feedback.code}]`);
  
  // Key info only
  if (feedback.ref) parts.push(feedback.ref);
  if (feedback.errors?.[0]) parts.push(feedback.errors[0].substring(0, 50));
  if (feedback.hint) parts.push(`→${feedback.hint}`);
  
  return parts.join(' ');
}

/**
 * Batch feedback from multiple tool executions
 */
export function batchFeedback(feedbacks: ActionFeedback[]): string {
  return feedbacks
    .map(fb => formatFeedbackCompact(fb))
    .join('\n');
}

/**
 * Analyze feedback patterns for improvement
 */
export function analyzeFeedbackPatterns(feedbacks: ActionFeedback[]): {
  successRate: number;
  commonErrors: Record<number, number>;
  averageTiming: number;
  recommendations: string[];
} {
  const total = feedbacks.length;
  const successful = feedbacks.filter(f => f.ok).length;
  const errorCounts: Record<number, number> = {};
  let totalTiming = 0;
  let timingCount = 0;

  feedbacks.forEach(fb => {
    if (!fb.ok) {
      errorCounts[fb.code] = (errorCounts[fb.code] || 0) + 1;
    }
    if (fb.timing) {
      totalTiming += fb.timing;
      timingCount++;
    }
  });

  const recommendations: string[] = [];
  
  // Generate recommendations based on patterns
  const topError = Object.entries(errorCounts)
    .sort(([,a], [,b]) => b - a)[0];
    
  if (topError) {
    const [code, count] = topError;
    const percentage = (count / total) * 100;
    if (percentage > 30) {
      recommendations.push(
        `High failure rate (${percentage.toFixed(0)}%) with code ${code}. Consider using browser_execute_js for debugging.`
      );
    }
  }

  if (timingCount > 0 && totalTiming / timingCount > 1000) {
    recommendations.push(
      `Slow average timing (${(totalTiming / timingCount).toFixed(0)}ms). Consider adding browser_wait or checking page load state.`
    );
  }

  return {
    successRate: (successful / total) * 100,
    commonErrors: errorCounts,
    averageTiming: timingCount > 0 ? totalTiming / timingCount : 0,
    recommendations
  };
}