import { Context } from "../context";
import { ToolResult } from "../tools/tool";

export async function captureAriaSnapshot(
  context: Context,
  status: string = "",
  options: { level?: 'minimal' | 'full' | 'scaffold'; viewportOnly?: boolean; mode?: string } = {},
): Promise<ToolResult> {
  // For navigation tools, default to scaffold mode for compact output
  const useScaffold = options.level === 'scaffold' || 
                      options.mode === 'scaffold' || 
                      (!options.level && !options.mode); // Default to scaffold if no options
  
  console.log('[captureAriaSnapshot] Options:', options, 'useScaffold:', useScaffold);
  
  if (useScaffold) {
    console.log('[captureAriaSnapshot] Sending scaffold mode request');
    const response = await context.sendSocketMessage("snapshot.accessibility", { mode: 'scaffold' });
    return {
      content: [
        {
          type: "text",
          text: status ? `${status}\n\n${response.snapshot}` : response.snapshot,
        },
      ],
    };
  }
  
  // Use specified mode for non-scaffold
  const snapshotOptions = {
    level: options.level || 'minimal',
    viewportOnly: options.viewportOnly ?? true
  };
  
  const response = await context.sendSocketMessage("snapshot.accessibility", snapshotOptions);
  return {
    content: [
      {
        type: "text",
        text: status ? `${status}\n\n${response.snapshot}` : response.snapshot,
      },
    ],
  };
}
