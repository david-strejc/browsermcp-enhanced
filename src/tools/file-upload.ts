import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import type { Context } from "../context";
import type { Tool } from "./tool";
import { ErrorRecovery } from "../utils/error-recovery";

// File input detection tool schema
const FileInputDetectionTool = z.object({
  name: z.literal("browser_detect_file_inputs"),
  description: z.literal("Detect and analyze all file input elements on the page. Essential before file uploads to understand acceptance criteria and constraints."),
  arguments: z.object({
    includeHidden: z.boolean().optional().default(false).describe("Whether to include hidden file inputs"),
    analyzeConstraints: z.boolean().optional().default(true).describe("Whether to analyze file type and size constraints")
  })
});

// File input detection tool
export const detectFileInputs: Tool = {
  schema: {
    name: FileInputDetectionTool.shape.name.value,
    description: FileInputDetectionTool.shape.description.value,
    inputSchema: zodToJsonSchema(FileInputDetectionTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      const validatedParams = FileInputDetectionTool.shape.arguments.parse(params || {});
      
      // Generate the file input detection script
      const detectionScript = generateFileInputDetectionScript(validatedParams);
      
      // Execute the detection script
      const response = await context.sendWithContext(
        "js.execute",
        {
          code: detectionScript,
          timeout: 5000
        },
        "detecting file input elements on page"
      );
      
      // Format the result
      let resultText: string;
      if (typeof response.result === 'object') {
        const result = response.result as any;
        if (result.fileInputs && Array.isArray(result.fileInputs)) {
          if (result.fileInputs.length === 0) {
            resultText = "No file input elements found on this page.";
          } else {
            resultText = `Found ${result.fileInputs.length} file input element(s):\\n\\n`;
            result.fileInputs.forEach((input: any, index: number) => {
              resultText += `${index + 1}. **${input.type}** input\\n`;
              resultText += `   - Ref: [${input.ref}]\\n`;
              resultText += `   - Accept: ${input.accept || 'any file type'}\\n`;
              resultText += `   - Multiple: ${input.multiple ? 'Yes' : 'No'}\\n`;
              resultText += `   - Required: ${input.required ? 'Yes' : 'No'}\\n`;
              if (input.maxSize) {
                resultText += `   - Max Size: ${formatFileSize(input.maxSize)}\\n`;
              }
              if (input.dropZone) {
                resultText += `   - Drop Zone: Available\\n`;
              }
              resultText += `\\n`;
            });
          }
        } else {
          resultText = JSON.stringify(response.result, null, 2);
        }
      } else {
        resultText = String(response.result || 'File input detection completed');
      }
      
      return {
        content: [
          {
            type: "text",
            text: `🔍 File Input Detection Results:\\n\\n${resultText}`,
          },
        ],
      };
    } catch (error) {
      return ErrorRecovery.handleToolError(
        error as Error,
        'browser_detect_file_inputs',
        'analyzing file input elements'
      );
    }
  },
};

// Helper function to generate file input detection script
function generateFileInputDetectionScript(params: any): string {
  return `
    (function() {
      // Find all file input elements
      let selector = 'input[type="file"]';
      ${!params.includeHidden ? `
      // Filter out hidden inputs
      const allInputs = Array.from(document.querySelectorAll(selector));
      const visibleInputs = allInputs.filter(input => {
        const style = window.getComputedStyle(input);
        return style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               style.opacity !== '0' &&
               input.offsetParent !== null;
      });
      ` : `
      const visibleInputs = Array.from(document.querySelectorAll(selector));
      `}
      
      const fileInputs = [];
      
      visibleInputs.forEach((input, index) => {
        const info = {
          ref: api.getRef ? api.getRef(input) : ('ref' + (index + 1)),
          type: 'file',
          accept: input.accept || null,
          multiple: input.multiple,
          required: input.required,
          disabled: input.disabled,
          name: input.name || null,
          id: input.id || null,
          className: input.className || null
        };
        
        ${params.analyzeConstraints ? `
        // Analyze constraints from accept attribute
        if (input.accept) {
          const types = input.accept.split(',').map(t => t.trim());
          info.acceptedTypes = types;
          info.acceptsImages = types.some(t => t.startsWith('image/') || t === 'image/*');
          info.acceptsDocuments = types.some(t => 
            t.includes('pdf') || t.includes('doc') || t.includes('txt') ||
            t === 'application/*' || t.includes('text/')
          );
        }
        
        // Look for size constraints in surrounding elements or data attributes
        const maxSizeAttr = input.getAttribute('data-max-size') || 
                          input.getAttribute('max-size') ||
                          input.dataset.maxSize;
        if (maxSizeAttr) {
          info.maxSize = parseInt(maxSizeAttr);
        }
        
        // Check if there's a drop zone associated
        const parent = input.closest('[ondrop], .drop-zone, .dropzone, [data-drop]');
        if (parent) {
          info.dropZone = {
            element: parent.tagName,
            className: parent.className
          };
        }
        ` : ''}
        
        fileInputs.push(info);
      });
      
      // Also look for drop zones without direct file inputs
      const dropZones = Array.from(document.querySelectorAll(
        '[ondrop], .drop-zone, .dropzone, [data-drop], [data-file-drop]'
      )).filter(zone => !zone.querySelector('input[type="file"]'));
      
      dropZones.forEach((zone, index) => {
        fileInputs.push({
          ref: api.getRef ? api.getRef(zone) : ('dropzone' + (index + 1)),
          type: 'dropzone',
          tagName: zone.tagName,
          className: zone.className,
          multiple: true, // Drop zones typically support multiple files
          accept: zone.getAttribute('data-accept') || null
        });
      });
      
      return {
        fileInputs: fileInputs,
        summary: {
          totalInputs: fileInputs.filter(i => i.type === 'file').length,
          totalDropZones: fileInputs.filter(i => i.type === 'dropzone').length,
          multipleAllowed: fileInputs.filter(i => i.multiple).length,
          requiredInputs: fileInputs.filter(i => i.required).length
        }
      };
    })();
  `;
}

// Helper function to format file sizes
function formatFileSize(bytes: number): string {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// Export all file upload tools
export const fileUploadTools = [
  detectFileInputs,
];