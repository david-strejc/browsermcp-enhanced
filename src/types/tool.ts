import { z } from "zod";

// Common tool schemas
export const NavigateTool = z.object({
  name: z.literal("browser_navigate"),
  description: z.literal("Navigate to a URL"),
  arguments: z.object({
    url: z.string().describe("The URL to navigate to"),
  }),
});

export const GoBackTool = z.object({
  name: z.literal("browser_go_back"),
  description: z.literal("Go back to the previous page"),
  arguments: z.object({}),
});

export const GoForwardTool = z.object({
  name: z.literal("browser_go_forward"),
  description: z.literal("Go forward to the next page"),
  arguments: z.object({}),
});

export const PressKeyTool = z.object({
  name: z.literal("browser_press_key"),
  description: z.literal("Press a key on the keyboard"),
  arguments: z.object({
    key: z.string().describe("Name of the key to press or a character to generate, such as `ArrowLeft` or `a`"),
  }),
});

export const WaitTool = z.object({
  name: z.literal("browser_wait"),
  description: z.literal("Wait for a specified time in seconds"),
  arguments: z.object({
    time: z.number().describe("The time to wait in seconds"),
  }),
});

// Custom tools
export const GetConsoleLogsTool = z.object({
  name: z.literal("browser_get_console_logs"),
  description: z.literal("Get console logs from the browser. Essential for debugging failed interactions, JavaScript errors, and page load issues."),
  arguments: z.object({}),
});

export const ScreenshotTool = z.object({
  name: z.literal("browser_screenshot"),
  description: z.literal("Capture page screenshot with adjustable quality/size. For Codex CLI/limited context: use quality='low', maxWidth=800, format='jpeg', jpegQuality=60. For detailed analysis: use quality='high', format='png'. Use captureMode='fullpage' for entire page height. Viewport capture is faster and smaller than full page."),
  arguments: z.object({
    // Quality presets
    quality: z.enum(['high', 'high-medium', 'medium-plus', 'medium', 'low', 'ultra-low']).optional().default('medium')
      .describe("Quality preset: 'high'=original, 'high-medium'=1920px, 'medium-plus'=1440px, 'medium'=1024px, 'low'=800px, 'ultra-low'=512px"),

    // Viewport configuration
    viewportWidth: z.number().min(800).max(3840).optional()
      .describe("Target viewport width. If not set, uses actual page width"),
    viewportHeight: z.number().min(600).max(2160).optional()
      .describe("Target viewport height. If not set, uses actual page height"),
    maintainFullHD: z.boolean().optional().default(false)
      .describe("Crop/scale to Full HD (1920x1080). Default false for full page captures"),

    // Size controls
    maxWidth: z.number().min(256).max(4096).optional()
      .describe("Max width in pixels (256-4096). Overrides quality preset. Lower = smaller file"),
    maxHeight: z.number().min(256).max(4096).optional()
      .describe("Max height in pixels (256-4096). Image maintains aspect ratio"),
    scaleFactor: z.number().min(0.1).max(1.0).optional()
      .describe("Scale factor (0.1-1.0). E.g., 0.5 = 50% size. Applied after maxWidth/maxHeight"),

    // Format options
    format: z.enum(['jpeg', 'png', 'webp']).optional().default('jpeg')
      .describe("Image format. 'jpeg'=smallest files, 'png'=lossless, 'webp'=good compression"),
    jpegQuality: z.number().min(10).max(100).optional()
      .describe("JPEG quality (10-100). Lower = smaller file. Only for JPEG format. 60-70 good for context-limited"),

    // Capture area
    captureMode: z.enum(['viewport', 'fullpage', 'region']).optional().default('viewport')
      .describe("'viewport'=visible area only (fastest/smallest), 'fullpage'=entire page height (auto-scrolls), 'region'=specific area"),

    // Full page configuration
    fullPageScrollDelay: z.number().min(100).max(2000).optional().default(500)
      .describe("Delay between scroll steps in milliseconds when capturing full page (100-2000ms)"),
    fullPageMaxHeight: z.number().min(1000).max(30000).optional().default(20000)
      .describe("Maximum height for full page capture in pixels (1000-30000). Prevents infinite scroll pages from causing issues"),
    autoFullPage: z.boolean().optional().default(false)
      .describe("Automatically use full page mode when Claude Code requests screenshots (configurable)"),
    region: z.object({
      x: z.number().describe("X coordinate of region"),
      y: z.number().describe("Y coordinate of region"),
      width: z.number().describe("Width of region"),
      height: z.number().describe("Height of region"),
    }).optional()
      .describe("Region coordinates for captureMode='region'. Captures specific area of page"),

    // Processing options
    grayscale: z.boolean().optional().default(false)
      .describe("Convert to grayscale. Reduces file size ~30% while maintaining readability"),
    blur: z.number().min(0).max(10).optional()
      .describe("Apply blur (0-10). Can reduce file size for non-text areas"),
    removeBackground: z.boolean().optional().default(false)
      .describe("Try to remove white backgrounds. May reduce size for pages with large white areas"),

    // Optimization
    optimize: z.boolean().optional().default(true)
      .describe("Apply automatic optimization based on content detection"),
    targetSizeKB: z.number().min(10).max(1000).optional()
      .describe("Target file size in KB (10-1000). System will adjust quality to meet target"),
  }),
});

// Snapshot tools
export const SnapshotTool = z.object({
  name: z.literal("browser_snapshot"),
  description: z.literal("Capture accessibility snapshot of the current page. Use this for getting references to elements to interact with. If elements missing, try browser_execute_js for dynamic content."),
  arguments: z.object({
    level: z.enum(['minimal', 'scaffold']).optional().describe("Snapshot detail level. 'minimal' shows only interactive elements (default), 'scaffold' shows ultra-compact view"),
    viewportOnly: z.boolean().optional().describe("Only include elements in viewport (default: true)"),
    mode: z.enum(['normal', 'scaffold']).optional().describe("Snapshot mode. 'scaffold' for ultra-minimal output")
  }),
});

export const ClickTool = z.object({
  name: z.literal("browser_click"),
  description: z.literal("Perform click on a web page. If click fails, use browser_execute_js to debug element state or try alternative selectors."),
  arguments: z.object({
    ref: z.string().describe("Exact target element reference from the page snapshot"),
    element: z.string().describe("Human-readable element description used to obtain permission to interact with the element"),
  }),
});

export const HoverTool = z.object({
  name: z.literal("browser_hover"),
  description: z.literal("Hover over element on page"),
  arguments: z.object({
    ref: z.string().describe("Exact target element reference from the page snapshot"),
    element: z.string().describe("Human-readable element description used to obtain permission to interact with the element"),
  }),
});

export const TypeTool = z.object({
  name: z.literal("browser_type"),
  description: z.literal("Type text into editable element. For input failures, use browser_get_console_logs and browser_execute_js to check element properties."),
  arguments: z.object({
    ref: z.string().describe("Exact target element reference from the page snapshot"),
    element: z.string().describe("Human-readable element description used to obtain permission to interact with the element"),
    text: z.string().describe("Text to type into the element"),
    submit: z.boolean().describe("Whether to submit entered text (press Enter after)"),
  }),
});

export const SelectOptionTool = z.object({
  name: z.literal("browser_select_option"),
  description: z.literal("Select an option in a dropdown. Complex dropdowns may require browser_execute_js for custom selection logic."),
  arguments: z.object({
    ref: z.string().describe("Exact target element reference from the page snapshot"),
    element: z.string().describe("Human-readable element description used to obtain permission to interact with the element"),
    values: z.array(z.string()).describe("Array of values to select in the dropdown. This can be a single value or multiple values."),
  }),
});

export const DragTool = z.object({
  name: z.literal("browser_drag"),
  description: z.literal("Drag an element to another element"),
  arguments: z.object({
    ref: z.string().describe("Exact target element reference from the page snapshot"),
    targetRef: z.string().describe("Exact target element reference to drag to"),
    element: z.string().describe("Human-readable element description used to obtain permission to interact with the element"),
  }),
});