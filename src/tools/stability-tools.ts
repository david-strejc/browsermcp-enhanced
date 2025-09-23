import type { Context } from '../context';
import type { Tool } from './tool';

// Wait for network idle tool
export const browserWaitForNetworkIdle: Tool = {
  schema: {
  name: 'browser_wait_for_network_idle',
  description: 'Wait for network activity to settle. Essential for dynamic content and SPAs.',
  inputSchema: {
    type: 'object',
    properties: {
      idleMs: {
        type: 'number',
        description: 'Milliseconds of no network activity to consider idle',
        default: 1500
      },
      timeoutMs: {
        type: 'number',
        description: 'Maximum time to wait for network idle',
        default: 20000
      }
    }
  }
  },
  handle: async (context: Context, { idleMs = 1500, timeoutMs = 20000 }) => {
    // First attach debugger if not already attached
    try {
      await context.sendSocketMessage("debugger.attach", { domains: ['network'] });
    } catch (e) {
      // Debugger might already be attached
    }

    const startTime = Date.now();
    let lastActivityTime = Date.now();
    let isIdle = false;

    // Monitor network activity
    const checkInterval = setInterval(() => {
      // Get recent network activity from debugger
      context.sendSocketMessage("debugger.getData", { type: 'network', limit: 1 }).then(response => {
        const data = response.data;
        if (data && data.length > 0) {
          const latestRequest = data[0];
          if (latestRequest.timestamp > lastActivityTime) {
            lastActivityTime = latestRequest.timestamp;
          }
        }

        // Check if we've been idle long enough
        if (Date.now() - lastActivityTime >= idleMs) {
          isIdle = true;
        }

        // Check timeout
        if (Date.now() - startTime >= timeoutMs) {
          isIdle = true; // Force idle on timeout
        }
      });
    }, 500);

    // Wait for idle or timeout
    while (!isIdle && Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    clearInterval(checkInterval);

    const actualIdleTime = Date.now() - lastActivityTime;
    return {
      content: [{
        type: "text",
        text: actualIdleTime >= idleMs
          ? `Network idle for ${actualIdleTime}ms`
          : `Timed out after ${timeoutMs}ms (last activity ${actualIdleTime}ms ago)`
      }]
    };
  }
};

// Wait for DOM stability tool
export const browserWaitForDomStable: Tool = {
  schema: {
  name: 'browser_wait_for_dom_stable',
  description: 'Wait for DOM to stop changing. Perfect for dynamic content and animations.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'Selector to monitor for stability (default: body)',
        default: 'body'
      },
      minStableMs: {
        type: 'number',
        description: 'Minimum milliseconds of no DOM changes to consider stable',
        default: 800
      },
      maxWaitMs: {
        type: 'number',
        description: 'Maximum time to wait for stability',
        default: 8000
      },
      checkIntervalMs: {
        type: 'number',
        description: 'How often to check for DOM changes',
        default: 200
      }
    }
  }
  },
  handle: async (context: Context, { selector = 'body', minStableMs = 800, maxWaitMs = 8000, checkIntervalMs = 200 }) => {
    const code = `
      (async function() {
        const element = document.querySelector('${selector}');
        if (!element) {
          return { success: false, error: 'Element not found: ${selector}' };
        }

        const startTime = Date.now();
        let lastChangeTime = Date.now();
        let lastHTML = element.innerHTML;
        let lastChildCount = element.children.length;
        let isStable = false;
        let changeCount = 0;

        while (!isStable && Date.now() - startTime < ${maxWaitMs}) {
          await new Promise(r => setTimeout(r, ${checkIntervalMs}));

          const currentHTML = element.innerHTML;
          const currentChildCount = element.children.length;

          // Check for changes
          if (currentHTML !== lastHTML || currentChildCount !== lastChildCount) {
            lastChangeTime = Date.now();
            lastHTML = currentHTML;
            lastChildCount = currentChildCount;
            changeCount++;
          }

          // Check if stable for required duration
          if (Date.now() - lastChangeTime >= ${minStableMs}) {
            isStable = true;
          }
        }

        const totalTime = Date.now() - startTime;
        const stableTime = Date.now() - lastChangeTime;

        return {
          success: true,
          stable: isStable,
          totalTime: totalTime,
          stableTime: stableTime,
          changeCount: changeCount,
          timedOut: !isStable && totalTime >= ${maxWaitMs}
        };
      })()
    `;

    try {
      const response = await context.sendSocketMessage("js.execute", {
        code: code,
        timeout: maxWaitMs + 1000,
        unsafe: true
      }, { timeoutMs: maxWaitMs + 1500 });
      const result = response.result;
      return {
        content: [{
          type: "text",
          text: result.stable
            ? `DOM stable for ${result.stableTime}ms after ${result.changeCount} changes`
            : `Timed out after ${result.totalTime}ms (${result.changeCount} changes detected)`
        }]
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

// Combined wait tool - wait for multiple conditions
export const browserWaitForReady: Tool = {
  schema: {
  name: 'browser_wait_for_ready',
  description: 'Universal wait tool - wait for elements, DOM stability, network idle, or custom conditions. Can wait for a single selector string or multiple complex conditions.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'Simple mode: CSS selector to wait for (shorthand for single element wait)'
      },
      conditions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['element', 'network', 'dom', 'function'],
              description: 'Type of condition to wait for'
            },
            config: {
              type: 'object',
              description: 'Configuration for the condition'
            }
          }
        },
        description: 'Advanced mode: Array of conditions to wait for'
      },
      mode: {
        type: 'string',
        enum: ['all', 'any'],
        description: 'Wait for all conditions or any condition',
        default: 'all'
      },
      timeoutMs: {
        type: 'number',
        description: 'Overall timeout',
        default: 15000
      },
      visible: {
        type: 'boolean',
        description: 'For simple selector mode: wait for element to be visible',
        default: false
      }
    }
  }
  },
  handle: async (context: Context, { selector, conditions = [], mode = 'all', timeoutMs = 15000, visible = false }) => {
    // Simple selector mode - just wait for a single element
    if (selector && !conditions.length) {
      const code = `
        const el = await api.waitFor('${selector}', {
          timeoutMs: ${timeoutMs},
          visible: ${visible}
        });
        return el ? true : false;
      `;

      try {
        const response = await context.sendSocketMessage("js.execute", {
          code: code,
          timeout: timeoutMs + 1000,
          unsafe: false
        }, { timeoutMs: timeoutMs + 1500 });
        const result = response.result;
        return {
          content: [{
            type: "text",
            text: result ? `Element found: ${selector}` : `Element not found within ${timeoutMs}ms: ${selector}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Error waiting for element: ${error.message}`
          }],
          isError: true
        };
      }
    }

    // Advanced mode - multiple conditions
    const startTime = Date.now();
    const results: any[] = [];

    for (const condition of conditions) {
      if (Date.now() - startTime >= timeoutMs) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: 'Overall timeout exceeded',
              results
            }, null, 2)
          }],
          isError: true
        };
      }

      const remainingTime = timeoutMs - (Date.now() - startTime);

      switch (condition.type) {
        case 'element': {
          const { selector, visible = false } = condition.config || {};
          const code = `
            const el = await api.waitFor('${selector}', {
              timeoutMs: ${Math.min(remainingTime, 10000)},
              visible: ${visible}
            });
            return !!el;
          `;
          const response = await context.sendSocketMessage("js.execute", {
            code: code,
            timeout: remainingTime,
            unsafe: false
          }, { timeoutMs: remainingTime + 500 });
          const result = response.result;
          results.push({ type: 'element', success: result, selector });

          if (mode === 'any' && result) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: true, matched: 'element', results }, null, 2)
              }]
            };
          }
          if (mode === 'all' && !result) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: false, failed: 'element', results }, null, 2)
              }],
              isError: true
            };
          }
          break;
        }

        case 'network': {
          const { idleMs = 1500 } = condition.config || {};
          const networkResult = await browserWaitForNetworkIdle.handle(context, {
            idleMs,
            timeoutMs: remainingTime
          });
          const networkSuccess = networkResult.content && networkResult.content[0]?.text?.includes('idle');
          results.push({ type: 'network', success: networkSuccess });

          if (mode === 'any' && networkSuccess) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: true, matched: 'network', results }, null, 2)
              }]
            };
          }
          if (mode === 'all' && !networkSuccess) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: false, failed: 'network', results }, null, 2)
              }],
              isError: true
            };
          }
          break;
        }

        case 'dom': {
          const { selector = 'body', minStableMs = 800 } = condition.config || {};
          const domResult = await browserWaitForDomStable.handle(context, {
            selector,
            minStableMs,
            maxWaitMs: remainingTime
          });
          const domStable = domResult.content && domResult.content[0]?.text?.includes('DOM stable');
          results.push({ type: 'dom', stable: domStable });

          if (mode === 'any' && domStable) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: true, matched: 'dom', results }, null, 2)
              }]
            };
          }
          if (mode === 'all' && !domStable) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: false, failed: 'dom', results }, null, 2)
              }],
              isError: true
            };
          }
          break;
        }

        case 'function': {
          const { code } = condition.config || {};
          if (!code) continue;

          const checkCode = `
            (async function() {
              const startTime = Date.now();
              while (Date.now() - startTime < ${remainingTime}) {
                const result = await (async function() { ${code} })();
                if (result) return true;
                await new Promise(r => setTimeout(r, 500));
              }
              return false;
            })()
          `;
          const response = await context.sendSocketMessage("js.execute", {
            code: checkCode,
            timeout: remainingTime,
            unsafe: true
          }, { timeoutMs: remainingTime + 500 });
          const result = response.result;
          results.push({ type: 'function', success: result });

          if (mode === 'any' && result) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: true, matched: 'function', results }, null, 2)
              }]
            };
          }
          if (mode === 'all' && !result) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: false, failed: 'function', results }, null, 2)
              }],
              isError: true
            };
          }
          break;
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: mode === 'all',
          message: mode === 'all' ? 'All conditions met' : 'No conditions met',
          results
        }, null, 2)
      }]
    };
  }
};