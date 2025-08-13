/**
 * Test scenarios for BrowserMCP Multitool
 * Demonstrates how to use the multitool to solve challenge pages and common scenarios
 */

import { BrowserMultitool } from './multitool';
import { registerAdvancedPatterns } from './multitool-advanced';

// Initialize multitool with all patterns
const multitool = new BrowserMultitool();
registerAdvancedPatterns(multitool);

/**
 * Test Scenarios for Challenge Pages
 */

// Challenge 1: Shadow Realms - Navigate through shadow DOM
export const shadowRealmsTest = {
  pattern: 'shadow_dom',
  targetText: '🏆 Claim Trophy',
  maxDepth: 3,
  description: 'Finds and clicks the trophy button hidden in nested shadow DOM'
};

// Challenge 2: Now You See Me - Multi-step visibility challenge
export const nowYouSeeMeTest = {
  pattern: 'multi_step_workflow',
  workflow: {
    stages: [
      {
        name: 'Dismiss Modal',
        actions: [
          { tool: 'browser_click', params: { ref: '#dismiss-overlay', element: 'dismiss button' } }
        ],
        verify: { type: 'element_hidden', selector: '#blocking-overlay' }
      },
      {
        name: 'Wait for API',
        actions: [
          { tool: 'browser_wait', params: { time: 2 } }
        ],
        waitBetween: 0.5
      },
      {
        name: 'Hover Tooltip',
        actions: [
          { tool: 'browser_hover', params: { ref: '#moving-tooltip', element: 'moving tooltip' } },
          { tool: 'browser_wait', params: { time: 1.5 } }
        ]
      },
      {
        name: 'Check Checkbox',
        actions: [
          { tool: 'browser_click', params: { ref: '#secret-checkbox', element: 'secret checkbox' } }
        ]
      },
      {
        name: 'Submit Form',
        actions: [
          { tool: 'browser_type', params: { ref: '#name', text: 'Test User', element: 'name field' } },
          { tool: 'browser_type', params: { ref: '#email', text: 'test@example.com', element: 'email field' } },
          { tool: 'browser_click', params: { ref: '#submit-button', element: 'submit button' } }
        ]
      }
    ]
  },
  checkpoints: true,
  description: 'Completes all 4 steps of the visibility challenge'
};

// Challenge 3: Rate Limit Ridge - Handle rate limiting
export const rateLimitRidgeTest = {
  pattern: 'rate_limited',
  actions: [
    { type: 'click', params: { ref: '#load-more-btn', element: 'load more button' } },
    { type: 'click', params: { ref: '#load-more-btn', element: 'load more button' } },
    { type: 'click', params: { ref: '#load-more-btn', element: 'load more button' } }
  ],
  requestsPerWindow: 2,
  windowSize: 5000,
  retryAfter: 4000,
  description: 'Loads 3 pages while respecting rate limits (2 requests per 5 seconds)'
};

// Challenge 4: Iframe Inception - Cross-origin communication
export const iframeInceptionTest = {
  pattern: 'multi_step_workflow',
  workflow: {
    stages: [
      {
        name: 'Dismiss Modal',
        actions: [
          { tool: 'browser_click', params: { ref: '#dismiss-modal-btn', element: 'dismiss modal' } }
        ]
      },
      {
        name: 'Login in Iframe',
        actions: [
          { tool: 'browser_execute_js', params: {
            code: `
              const iframe = document.getElementById('main-iframe');
              const iframeDoc = iframe.contentDocument;
              iframeDoc.getElementById('username').value = 'testuser';
              iframeDoc.getElementById('password').value = 'testpass';
              iframeDoc.getElementById('login-btn').click();
            `,
            unsafe: true
          }}
        ]
      },
      {
        name: 'Handle Token Exchange',
        actions: [
          { tool: 'browser_wait', params: { time: 1 } },
          { tool: 'browser_click', params: { ref: '#send-token-btn', element: 'send token button' } }
        ]
      },
      {
        name: 'Complete Challenge',
        actions: [
          { tool: 'browser_execute_js', params: {
            code: `
              const iframe = document.getElementById('main-iframe');
              iframe.contentDocument.getElementById('complete-btn').click();
            `,
            unsafe: true
          }}
        ]
      }
    ]
  },
  description: 'Completes cross-origin iframe authentication flow'
};

// Challenge 5: Endless Valley - Infinite scroll
export const endlessValleyTest = {
  pattern: 'infinite_scroll',
  targetText: 'Golden Egg',
  maxScrolls: 150,
  scrollDelay: 0.5,
  description: 'Scrolls through infinite content to find and click the Golden Egg article'
};

/**
 * Common Real-World Scenarios
 */

// Login to GitHub
export const githubLoginTest = {
  pattern: 'login',
  username: 'your-username',
  password: 'your-password',
  rememberMe: false,
  description: 'Login to GitHub account'
};

// Google Search
export const googleSearchTest = {
  pattern: 'search',
  query: 'BrowserMCP automation',
  waitForResults: 2,
  resultSelector: '.g',
  description: 'Search Google and count results'
};

// Fill Contact Form
export const contactFormTest = {
  pattern: 'form_fill',
  fields: {
    name: 'John Doe',
    email: 'john@example.com',
    subject: 'Test Message',
    message: 'This is a test message from BrowserMCP multitool'
  },
  submitButton: 'button[type="submit"]',
  waitAfterSubmit: 2,
  description: 'Fill and submit a contact form'
};

// E-commerce Checkout Flow
export const checkoutFlowTest = {
  pattern: 'multi_step_workflow',
  workflow: {
    stages: [
      {
        name: 'Add to Cart',
        actions: [
          { tool: 'browser_click', params: { ref: '.add-to-cart', element: 'add to cart button' } }
        ]
      },
      {
        name: 'Go to Checkout',
        actions: [
          { tool: 'browser_wait', params: { time: 1 } },
          { tool: 'browser_click', params: { ref: '.checkout-btn', element: 'checkout button' } }
        ]
      },
      {
        name: 'Fill Shipping',
        actions: [
          { tool: 'browser_type', params: { ref: '#shipping-name', text: 'John Doe' } },
          { tool: 'browser_type', params: { ref: '#shipping-address', text: '123 Main St' } },
          { tool: 'browser_type', params: { ref: '#shipping-city', text: 'New York' } },
          { tool: 'browser_select_option', params: { ref: '#shipping-state', values: ['NY'] } },
          { tool: 'browser_type', params: { ref: '#shipping-zip', text: '10001' } }
        ]
      },
      {
        name: 'Payment Info',
        actions: [
          { tool: 'browser_type', params: { ref: '#card-number', text: '4111111111111111' } },
          { tool: 'browser_type', params: { ref: '#card-expiry', text: '12/25' } },
          { tool: 'browser_type', params: { ref: '#card-cvv', text: '123' } }
        ]
      },
      {
        name: 'Place Order',
        actions: [
          { tool: 'browser_click', params: { ref: '#place-order', element: 'place order button' } }
        ]
      }
    ]
  },
  checkpoints: true,
  rollbackOnError: true,
  description: 'Complete e-commerce checkout process'
};

// Social Media Post
export const socialMediaPostTest = {
  pattern: 'multi_step_workflow',
  workflow: {
    stages: [
      {
        name: 'Open Compose',
        actions: [
          { tool: 'browser_click', params: { ref: '.compose-button', element: 'compose button' } }
        ]
      },
      {
        name: 'Write Post',
        actions: [
          { tool: 'browser_type', params: { 
            ref: '.post-input', 
            text: 'Testing BrowserMCP multitool! 🚀',
            element: 'post input'
          }}
        ]
      },
      {
        name: 'Add Image',
        actions: [
          { tool: 'browser_simulate_file_upload', params: {
            ref: '.image-upload',
            element: 'image upload',
            files: [{ name: 'test.jpg', type: 'image/jpeg' }]
          }}
        ],
        condition: { type: 'element_exists', selector: '.image-upload' }
      },
      {
        name: 'Post',
        actions: [
          { tool: 'browser_click', params: { ref: '.post-button', element: 'post button' } }
        ]
      }
    ]
  },
  description: 'Create a social media post with text and image'
};

// Data Scraping Example
export const scrapingTest = {
  pattern: 'extract_data',
  selectors: {
    container: '.product-item',
    title: '.product-title',
    price: '.product-price',
    description: '.product-description',
    image: '.product-image img',
    link: '.product-link'
  },
  pagination: {
    maxPages: 3
  },
  format: 'json',
  description: 'Extract product data from multiple pages'
};

// Complex Navigation Sequence
export const navigationTest = {
  pattern: 'navigation_sequence',
  steps: [
    { type: 'navigate', url: 'https://example.com' },
    { type: 'click', ref: '.menu-item-products', element: 'products menu' },
    { type: 'wait', duration: 2 },
    { type: 'click', ref: '.category-electronics', element: 'electronics category' },
    { type: 'click', ref: '.sort-dropdown', element: 'sort dropdown' },
    { type: 'click', ref: '.sort-price-low', element: 'sort by price' },
    { type: 'wait', duration: 1 },
    { type: 'click', ref: '.product-card:first-child', element: 'first product' }
  ],
  waitBetween: 0.5,
  stopOnError: false,
  description: 'Navigate through a product catalog'
};

// Modal and Popup Handling
export const modalHandlingTest = {
  pattern: 'dismiss_modals',
  dismissTexts: ['accept', 'close', 'no thanks', 'skip'],
  escapeKey: true,
  description: 'Dismiss all modals and popups on the page'
};

/**
 * Test Runner
 */
export async function runMultitoolTest(testName: string, browserDriver: any) {
  const tests: Record<string, any> = {
    shadowRealms: shadowRealmsTest,
    nowYouSeeMe: nowYouSeeMeTest,
    rateLimitRidge: rateLimitRidgeTest,
    iframeInception: iframeInceptionTest,
    endlessValley: endlessValleyTest,
    githubLogin: githubLoginTest,
    googleSearch: googleSearchTest,
    contactForm: contactFormTest,
    checkoutFlow: checkoutFlowTest,
    socialMediaPost: socialMediaPostTest,
    scraping: scrapingTest,
    navigation: navigationTest,
    modalHandling: modalHandlingTest
  };

  const test = tests[testName];
  if (!test) {
    throw new Error(`Test ${testName} not found`);
  }

  console.log(`Running test: ${test.description}`);
  console.log('Parameters:', test);

  const result = await multitool.execute(test);
  
  console.log('Result:', result);
  
  if (result.success) {
    console.log(`✅ Test passed in ${result.duration}ms with ${result.steps} steps`);
  } else {
    console.log(`❌ Test failed: ${result.error}`);
  }

  return result;
}

/**
 * Batch Test Runner
 */
export async function runAllTests(browserDriver: any) {
  const results: Record<string, any> = {};
  
  // Challenge tests
  const challengeTests = [
    'shadowRealms',
    'nowYouSeeMe', 
    'rateLimitRidge',
    'iframeInception',
    'endlessValley'
  ];

  console.log('Running Challenge Tests...');
  for (const test of challengeTests) {
    results[test] = await runMultitoolTest(test, browserDriver);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Delay between tests
  }

  // Common scenario tests (optional)
  const scenarioTests = [
    'googleSearch',
    'contactForm',
    'navigation',
    'modalHandling'
  ];

  console.log('\nRunning Scenario Tests...');
  for (const test of scenarioTests) {
    results[test] = await runMultitoolTest(test, browserDriver);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Summary
  console.log('\n=== Test Summary ===');
  let passed = 0;
  let failed = 0;

  for (const [name, result] of Object.entries(results)) {
    if (result.success) {
      console.log(`✅ ${name}: PASSED`);
      passed++;
    } else {
      console.log(`❌ ${name}: FAILED - ${result.error}`);
      failed++;
    }
  }

  console.log(`\nTotal: ${passed} passed, ${failed} failed`);
  
  return results;
}