import { Context } from "../context";
import { ToolResult } from "../tools/tool";

export async function captureAriaSnapshot(
  context: Context,
  status: string = "",
): Promise<ToolResult> {
  const response = await context.sendSocketMessage("snapshot.accessibility", {});
  return {
    content: [
      {
        type: "text",
        text: status ? `${status}\n\n${response.snapshot}` : response.snapshot,
      },
    ],
  };
}
