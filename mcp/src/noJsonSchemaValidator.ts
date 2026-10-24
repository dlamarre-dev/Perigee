/**
 * Stands in for the MCP SDK's ajv-provider in the bundle (alias in mcp/vite.config.ts). The SDK server only
 * validates JSON Schemas for elicitation, which Perigee never uses; ajv compiles schemas with `Function`, which
 * package scanners flag as eval, and would be dead code here.
 */
export class AjvJsonSchemaValidator {
  getValidator(): never {
    throw new Error('perigee-mcp: JSON Schema validation (elicitation) is not supported');
  }
}
