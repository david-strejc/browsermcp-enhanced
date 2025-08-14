import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import type { Context } from "../context";
import type { Tool } from "./tool";

// Define the tool schema
const ProductVerifierTool = z.object({
  name: z.literal("browser_verify_product"),
  description: z.literal("Verify that a product matches the intended search criteria before adding to cart. Prevents adding wrong items (e.g., battery-powered devices instead of batteries). Returns confidence score and detailed analysis."),
  arguments: z.object({
    product_ref: z.string().describe("Reference to the product element to verify"),
    expected_category: z.string().describe("Expected product category (e.g., 'batteries', 'phones', 'cables')"),
    expected_keywords: z.array(z.string()).describe("Keywords that MUST appear in product (e.g., ['AAA', 'battery'])"),
    excluded_keywords: z.array(z.string()).optional().describe("Keywords that must NOT appear (e.g., ['holder', 'charger', 'case'])"),
    min_confidence: z.number().optional().default(0.7).describe("Minimum confidence threshold (0-1)")
  })
});

// Product verification tool
export const verifyProduct: Tool = {
  schema: {
    name: ProductVerifierTool.shape.name.value,
    description: ProductVerifierTool.shape.description.value,
    inputSchema: zodToJsonSchema(ProductVerifierTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    const validatedParams = ProductVerifierTool.shape.arguments.parse(params || {});
    
    const verificationCode = `
      const element = document.querySelector('[data-browsermcp-ref="${validatedParams.product_ref}"]') ||
                      document.querySelector('${validatedParams.product_ref}');
      
      if (!element) {
        return { error: 'Product element not found' };
      }
      
      // Gather all text from the product element
      const productText = (element.textContent || element.innerText || '').toLowerCase();
      const productTitle = element.querySelector('h1, h2, h3, h4, .title, .name, [class*="title"], [class*="name"]')?.textContent?.toLowerCase() || '';
      
      // Check for category indicators
      const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb, nav [aria-label*="breadcrumb"], [class*="category"]'))
        .map(el => el.textContent?.toLowerCase() || '')
        .join(' ');
      
      // Look for product specifications
      const specs = Array.from(element.querySelectorAll('dl, .specs, .attributes, [class*="spec"], [class*="attribute"]'))
        .map(el => el.textContent?.toLowerCase() || '')
        .join(' ');
      
      // Calculate confidence scores
      let confidence = 0;
      const signals = [];
      
      // Check expected keywords
      const expectedKeywords = ${JSON.stringify(validatedParams.expected_keywords.map(k => k.toLowerCase()))};
      const foundKeywords = expectedKeywords.filter(keyword => {
        // Check in title (highest weight)
        if (productTitle.includes(keyword)) {
          signals.push({ type: 'title_match', keyword, weight: 0.4 });
          return true;
        }
        // Check in general text
        if (productText.includes(keyword)) {
          signals.push({ type: 'text_match', keyword, weight: 0.2 });
          return true;
        }
        return false;
      });
      
      confidence += (foundKeywords.length / expectedKeywords.length) * 0.5;
      
      // Check excluded keywords
      const excludedKeywords = ${JSON.stringify((validatedParams.excluded_keywords || []).map(k => k.toLowerCase()))};
      const foundExcluded = excludedKeywords.filter(keyword => productText.includes(keyword));
      
      if (foundExcluded.length > 0) {
        confidence -= 0.3 * foundExcluded.length;
        foundExcluded.forEach(keyword => {
          signals.push({ type: 'excluded_found', keyword, weight: -0.3 });
        });
      }
      
      // Check category match
      const expectedCategory = '${validatedParams.expected_category.toLowerCase()}';
      if (breadcrumbs.includes(expectedCategory) || productText.includes(expectedCategory)) {
        confidence += 0.3;
        signals.push({ type: 'category_match', weight: 0.3 });
      }
      
      // Check for common false positives
      const falsePositiveIndicators = ['uses', 'requires', 'powered by', 'compatible with', 'for use with'];
      const hasFalsePositive = falsePositiveIndicators.some(indicator => 
        productText.includes(indicator + ' ' + expectedKeywords.join(' '))
      );
      
      if (hasFalsePositive) {
        confidence -= 0.4;
        signals.push({ type: 'false_positive_pattern', weight: -0.4 });
      }
      
      // Ensure confidence is between 0 and 1
      confidence = Math.max(0, Math.min(1, confidence));
      
      return {
        confidence,
        productTitle: productTitle.substring(0, 200),
        foundKeywords,
        missingKeywords: expectedKeywords.filter(k => !foundKeywords.includes(k)),
        excludedFound: foundExcluded,
        signals,
        recommendation: confidence >= ${validatedParams.min_confidence} ? 'PROCEED' : 'SKIP',
        warning: hasFalsePositive ? 'This appears to be a product that USES the item, not the item itself' : null
      };
    `;
    
    try {
      console.log(`[Product Verifier] Verifying product with ref: ${validatedParams.product_ref}`);
      
      const response = await context.sendSocketMessage("js.execute", {
        code: verificationCode,
        timeout: 3000,
        unsafe: true
      }, { timeoutMs: 3500 });
      
      if (response.result?.error) {
        return {
          content: [{
            type: "text",
            text: `Error: ${response.result.error}`
          }]
        };
      }
      
      const result = response.result;
      
      // Format the verification report
      let report = `Product Verification Report\n`;
      report += `${'='.repeat(40)}\n\n`;
      report += `Product: ${result.productTitle}\n`;
      report += `Confidence: ${(result.confidence * 100).toFixed(1)}%\n`;
      report += `Recommendation: ${result.recommendation}\n\n`;
      
      if (result.warning) {
        report += `⚠️ WARNING: ${result.warning}\n\n`;
      }
      
      report += `Expected Keywords:\n`;
      result.foundKeywords.forEach((kw: string) => {
        report += `  ✓ ${kw}\n`;
      });
      result.missingKeywords.forEach((kw: string) => {
        report += `  ✗ ${kw} (not found)\n`;
      });
      
      if (result.excludedFound.length > 0) {
        report += `\nExcluded Keywords Found:\n`;
        result.excludedFound.forEach((kw: string) => {
          report += `  ⚠️ ${kw}\n`;
        });
      }
      
      report += `\nConfidence Breakdown:\n`;
      result.signals.forEach((signal: any) => {
        const sign = signal.weight > 0 ? '+' : '';
        report += `  ${signal.type}: ${sign}${(signal.weight * 100).toFixed(0)}%\n`;
      });
      
      if (result.recommendation === 'SKIP') {
        report += `\n❌ DO NOT ADD TO CART - Product does not match criteria\n`;
        report += `Suggestion: Continue searching or refine search terms\n`;
      } else {
        report += `\n✅ SAFE TO PROCEED - Product matches criteria\n`;
      }
      
      return {
        content: [{
          type: "text",
          text: report
        }]
      };
      
    } catch (error) {
      console.error('[Product Verifier] Error:', error);
      throw error;
    }
  }
};