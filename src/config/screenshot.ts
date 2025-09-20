// Screenshot configuration for browser MCP
export interface ScreenshotConfig {
  // Default settings for Claude Code
  claudeCode: {
    // Automatically use full page mode when Claude Code requests screenshots
    autoFullPage: boolean;
    // Default quality for Claude Code screenshots
    defaultQuality: 'high' | 'high-medium' | 'medium-plus' | 'medium' | 'low' | 'ultra-low';
    // Default format for Claude Code screenshots
    defaultFormat: 'jpeg' | 'png' | 'webp';
    // JPEG quality for Claude Code screenshots (1-100)
    defaultJpegQuality: number;
    // Maximum height for full page captures (pixels)
    fullPageMaxHeight: number;
    // Delay between scroll steps (milliseconds)
    fullPageScrollDelay: number;
  };

  // Default settings for other clients
  defaults: {
    quality: 'high' | 'high-medium' | 'medium-plus' | 'medium' | 'low' | 'ultra-low';
    format: 'jpeg' | 'png' | 'webp';
    jpegQuality: number;
    captureMode: 'viewport' | 'fullpage' | 'region';
  };
}

// Default configuration
export const defaultScreenshotConfig: ScreenshotConfig = {
  claudeCode: {
    autoFullPage: false, // Set to true to automatically capture full page for Claude Code
    defaultQuality: 'medium-plus',
    defaultFormat: 'jpeg',
    defaultJpegQuality: 85,
    fullPageMaxHeight: 20000,
    fullPageScrollDelay: 500
  },
  defaults: {
    quality: 'medium',
    format: 'jpeg',
    jpegQuality: 80,
    captureMode: 'viewport'
  }
};

// Configuration can be overridden by environment variables or config file
export function loadScreenshotConfig(): ScreenshotConfig {
  const config = { ...defaultScreenshotConfig };

  // Check for environment variable overrides
  if (process.env.BROWSER_MCP_CLAUDE_AUTO_FULLPAGE === 'true') {
    config.claudeCode.autoFullPage = true;
  }

  if (process.env.BROWSER_MCP_FULLPAGE_MAX_HEIGHT) {
    const height = parseInt(process.env.BROWSER_MCP_FULLPAGE_MAX_HEIGHT);
    if (!isNaN(height) && height >= 1000 && height <= 30000) {
      config.claudeCode.fullPageMaxHeight = height;
    }
  }

  if (process.env.BROWSER_MCP_FULLPAGE_SCROLL_DELAY) {
    const delay = parseInt(process.env.BROWSER_MCP_FULLPAGE_SCROLL_DELAY);
    if (!isNaN(delay) && delay >= 100 && delay <= 2000) {
      config.claudeCode.fullPageScrollDelay = delay;
    }
  }

  return config;
}