import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import type { Context } from "../context";
import type { Tool } from "./tool";
import { ErrorRecovery } from "../utils/error-recovery";

// File upload simulation tool schema
const FileUploadTool = z.object({
  name: z.literal("browser_simulate_file_upload"),
  description: z.literal("Simulate file upload by creating mock files and triggering file input elements"),
  arguments: z.object({
    ref: z.string().describe("The ref ID of the file input element"),
    element: z.string().describe("Human-readable element description"),
    files: z.array(z.object({
      name: z.string().describe("File name (e.g., 'document.pdf')"),
      type: z.string().describe("MIME type (e.g., 'application/pdf', 'image/jpeg')"),
      size: z.number().optional().describe("File size in bytes (defaults to realistic size)"),
      content: z.string().optional().describe("Optional file content (base64 encoded or text)")
    })).describe("Array of files to simulate"),
    triggerChange: z.boolean().optional().default(true).describe("Whether to trigger change events after upload")
  })
});

// Drag and drop file upload tool schema  
const DragDropUploadTool = z.object({
  name: z.literal("browser_simulate_drag_drop_upload"),
  description: z.literal("Simulate drag and drop file upload to a drop zone element"),
  arguments: z.object({
    ref: z.string().describe("The ref ID of the drop zone element"),
    element: z.string().describe("Human-readable element description"),
    files: z.array(z.object({
      name: z.string().describe("File name"),
      type: z.string().describe("MIME type"),
      size: z.number().optional().describe("File size in bytes"),
      content: z.string().optional().describe("Optional file content")
    })).describe("Array of files to simulate"),
    dragEvents: z.boolean().optional().default(true).describe("Whether to simulate full drag event sequence")
  })
});

// File input detection tool schema
const FileInputDetectionTool = z.object({
  name: z.literal("browser_detect_file_inputs"),
  description: z.literal("Detect and analyze all file input elements on the page"),
  arguments: z.object({
    includeHidden: z.boolean().optional().default(false).describe("Whether to include hidden file inputs"),
    analyzeConstraints: z.boolean().optional().default(true).describe("Whether to analyze file type and size constraints")
  })
});

// File upload simulation tool
export const simulateFileUpload: Tool = {
  schema: {
    name: FileUploadTool.shape.name.value,
    description: FileUploadTool.shape.description.value,
    inputSchema: zodToJsonSchema(FileUploadTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      const validatedParams = FileUploadTool.shape.arguments.parse(params || {});
      
      // Generate the file upload simulation script
      const uploadScript = generateFileUploadScript(validatedParams);
      
      // Execute the file upload simulation
      const response = await context.sendWithContext(
        "js.execute",
        {
          code: uploadScript,
          timeout: 10000
        },
        `simulating file upload to ${validatedParams.element} with ${validatedParams.files.length} file(s)`
      );
      
      // Format the result
      let resultText: string;
      if (typeof response.result === 'object') {
        resultText = JSON.stringify(response.result, null, 2);
      } else {
        resultText = String(response.result || 'File upload simulation completed');
      }
      
      return {
        content: [
          {
            type: "text",
            text: `✅ File Upload Simulation: ${validatedParams.element}\\n\\n${resultText}`,
          },
        ],
      };
    } catch (error) {
      return ErrorRecovery.handleToolError(
        error as Error,
        'browser_simulate_file_upload',
        params ? `element "${(params as any).element}"` : undefined
      );
    }
  },
};

// Drag and drop upload simulation tool
export const simulateDragDropUpload: Tool = {
  schema: {
    name: DragDropUploadTool.shape.name.value,
    description: DragDropUploadTool.shape.description.value,
    inputSchema: zodToJsonSchema(DragDropUploadTool.shape.arguments),
  },
  handle: async (context: Context, params) => {
    try {
      const validatedParams = DragDropUploadTool.shape.arguments.parse(params || {});
      
      // Generate the drag and drop simulation script
      const dragDropScript = generateDragDropScript(validatedParams);
      
      // Execute the drag and drop simulation
      const response = await context.sendWithContext(
        "js.execute",
        {
          code: dragDropScript,
          timeout: 10000
        },
        `simulating drag & drop upload to ${validatedParams.element}`
      );
      
      // Format the result
      let resultText: string;
      if (typeof response.result === 'object') {
        resultText = JSON.stringify(response.result, null, 2);
      } else {
        resultText = String(response.result || 'Drag & drop simulation completed');
      }
      
      return {
        content: [
          {
            type: "text",
            text: `✅ Drag & Drop Upload Simulation: ${validatedParams.element}\\n\\n${resultText}`,
          },
        ],
      };
    } catch (error) {
      return ErrorRecovery.handleToolError(
        error as Error,
        'browser_simulate_drag_drop_upload',
        params ? `drop zone "${(params as any).element}"` : undefined
      );
    }
  },
};

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

// Helper function to generate file upload simulation script
function generateFileUploadScript(params: any): string {
  return `
    (function() {
      // Find the file input element using element tracker
      const input = window.__elementTracker ? window.__elementTracker.getElementById('${params.ref}') : null;
      if (!input) {
        return { error: "File input element not found with ref: ${params.ref}" };
      }
      
      if (input.type !== 'file') {
        return { error: "Element is not a file input: " + input.tagName + "[type=" + input.type + "]" };
      }
      
      // Create mock File objects
      const files = [];
      ${params.files.map((file: any, index: number) => `
        // File ${index + 1}: ${file.name}
        const file${index} = new File(
          [${file.content ? `'${file.content}'` : `'Mock content for ${file.name}'`}],
          '${file.name}',
          { 
            type: '${file.type}',
            lastModified: Date.now()
          }
        );
        // Set size property if specified
        ${file.size ? `Object.defineProperty(file${index}, 'size', { value: ${file.size} });` : ''}
        files.push(file${index});
      `).join('')}
      
      // Create a DataTransfer object to simulate file selection
      const dataTransfer = new DataTransfer();
      files.forEach(file => dataTransfer.items.add(file));
      
      // Set the files property on the input
      try {
        input.files = dataTransfer.files;
        
        // Trigger events to simulate user file selection
        const events = [];
        
        // Focus the input
        input.focus();
        events.push('focus');
        
        // Trigger change event
        ${params.triggerChange ? `
        const changeEvent = new Event('change', { bubbles: true });
        input.dispatchEvent(changeEvent);
        events.push('change');
        ` : ''}
        
        // Trigger input event
        const inputEvent = new Event('input', { bubbles: true });
        input.dispatchEvent(inputEvent);
        events.push('input');
        
        return {
          success: true,
          filesAdded: files.length,
          fileNames: files.map(f => f.name),
          totalSize: files.reduce((sum, f) => sum + f.size, 0),
          eventsTriggered: events,
          inputElement: {
            accept: input.accept || 'any',
            multiple: input.multiple,
            required: input.required
          }
        };
      } catch (error) {
        return {
          error: "Failed to simulate file upload: " + error.message,
          files: files.map(f => ({ name: f.name, size: f.size, type: f.type }))
        };
      }
    })();
  `;
}

// Helper function to generate drag and drop simulation script
function generateDragDropScript(params: any): string {
  return `
    (function() {
      // Find the drop zone element using element tracker
      const dropZone = window.__elementTracker ? window.__elementTracker.getElementById('${params.ref}') : null;
      if (!dropZone) {
        return { error: "Drop zone element not found with ref: ${params.ref}" };
      }
      
      // Create mock File objects
      const files = [];
      ${params.files.map((file: any, index: number) => `
        const file${index} = new File(
          [${file.content ? `'${file.content}'` : `'Mock content for ${file.name}'`}],
          '${file.name}',
          { 
            type: '${file.type}',
            lastModified: Date.now()
          }
        );
        ${file.size ? `Object.defineProperty(file${index}, 'size', { value: ${file.size} });` : ''}
        files.push(file${index});
      `).join('')}
      
      // Create DataTransfer object with files
      const dataTransfer = new DataTransfer();
      files.forEach(file => dataTransfer.items.add(file));
      
      const events = [];
      
      try {
        ${params.dragEvents ? `
        // Simulate full drag and drop sequence
        const dragEnterEvent = new DragEvent('dragenter', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });
        dropZone.dispatchEvent(dragEnterEvent);
        events.push('dragenter');
        
        const dragOverEvent = new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });
        dropZone.dispatchEvent(dragOverEvent);
        events.push('dragover');
        ` : ''}
        
        // Main drop event
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });
        dropZone.dispatchEvent(dropEvent);
        events.push('drop');
        
        // Trigger any file input change events if associated
        const fileInputs = dropZone.querySelectorAll('input[type="file"]');
        fileInputs.forEach(input => {
          input.files = dataTransfer.files;
          const changeEvent = new Event('change', { bubbles: true });
          input.dispatchEvent(changeEvent);
        });
        
        return {
          success: true,
          filesDropped: files.length,
          fileNames: files.map(f => f.name),
          totalSize: files.reduce((sum, f) => sum + f.size, 0),
          eventsTriggered: events,
          dropZoneInfo: {
            tagName: dropZone.tagName,
            className: dropZone.className,
            hasFileInput: fileInputs.length > 0
          }
        };
      } catch (error) {
        return {
          error: "Failed to simulate drag & drop: " + error.message,
          files: files.map(f => ({ name: f.name, size: f.size, type: f.type }))
        };
      }
    })();
  `;
}

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
  simulateFileUpload,
  simulateDragDropUpload,
  detectFileInputs,
];