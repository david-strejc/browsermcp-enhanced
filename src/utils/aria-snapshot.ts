import { Context } from "../context";
import { ToolResult } from "../tools/tool";

export async function captureAriaSnapshot(
  context: Context,
  status: string = "",
  options: { level?: 'minimal' | 'full' | 'scaffold'; viewportOnly?: boolean; mode?: string; includeInstanceContext?: boolean } = {},
): Promise<ToolResult> {
  // Build instance context header (default: true) - will be built after response
  const includeContext = options.includeInstanceContext !== false;

  function buildInstanceContext(): string {
    if (!includeContext) return '';
    const instanceId = context.instanceId ? context.instanceId.substring(0, 8) : 'unknown';
    const tabId = context.currentTabId || 'none';
    const port = context.port || 'unknown';
    return `[Instance: ${instanceId}... | Tab: ${tabId} | Port: ${port}]\n\n`;
  }
  // For navigation tools, default to scaffold mode for compact output
  const useScaffold = options.level === 'scaffold' || 
                      options.mode === 'scaffold' || 
                      (!options.level && !options.mode); // Default to scaffold if no options
  
  console.log('[captureAriaSnapshot] Options:', options, 'useScaffold:', useScaffold);
  
  if (useScaffold) {
    console.log('[captureAriaSnapshot] Sending scaffold mode request');
    const response: any = await context.sendSocketMessage("snapshot.accessibility", { mode: 'scaffold' });

    // Update current tab ID if provided
    if (response && typeof response.tabId !== 'undefined') {
      context.currentTabId = String(response.tabId);
    }

    const instanceContext = buildInstanceContext();
    const fullText = instanceContext + (status ? `${status}\n\n${response.snapshot}` : response.snapshot);
    return {
      content: [
        {
          type: "text",
          text: fullText,
        },
      ],
    };
  }
  
  // Use specified mode for non-scaffold
  const snapshotOptions = {
    level: options.level || 'minimal',
    viewportOnly: options.viewportOnly ?? true
  };
  
  console.log('[aria-snapshot.ts] Sending snapshot request with options:', snapshotOptions);
  const response: any = await context.sendSocketMessage("snapshot.accessibility", snapshotOptions);
  console.log('[aria-snapshot.ts] Received response, snapshot length:', response.snapshot?.length);

  // Update current tab ID if provided
  if (response && typeof response.tabId !== 'undefined') {
    context.currentTabId = String(response.tabId);
  }

  const instanceContext = buildInstanceContext();
  const fullText = instanceContext + (status ? `${status}\n\n${response.snapshot}` : response.snapshot);
  return {
    content: [
      {
        type: "text",
        text: fullText,
      },
    ],
  };
}
