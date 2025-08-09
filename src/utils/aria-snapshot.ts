import { Context } from "../context";
import { ToolResult } from "../tools/tool";

export async function captureAriaSnapshot(
  context: Context,
  status: string = "",
  options: { level?: 'minimal' | 'full' | 'scaffold'; viewportOnly?: boolean; mode?: string } = {},
): Promise<ToolResult> {
  // Check for scaffold mode
  if (options.level === 'scaffold' || options.mode === 'scaffold') {
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
  
  // Default to minimal mode for better token efficiency
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
