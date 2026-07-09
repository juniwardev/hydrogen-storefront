/**
 * Shared McpError class — SERVER ONLY.
 *
 * Extracted from mcp.server.js into its own module so that mcp.server.js and
 * ucp-auth.server.js (the DEV-ONLY cookie shim) can both throw/catch the same
 * error type without a circular import between them (mcp.server.js calls
 * ensureStorefrontDigest(); ensureStorefrontDigest() throws McpError on a
 * config error).
 */

/**
 * @typedef {'rate_limited' | 'http_error' | 'rpc_error' | 'tool_error' | 'empty_result' | 'timeout' | 'config_error'} McpErrorCode
 */
export class McpError extends Error {
  /**
   * @param {McpErrorCode} code
   * @param {object} [detail]
   */
  constructor(code, detail = {}) {
    super(code);
    this.name = 'McpError';
    /** @type {McpErrorCode} */
    this.code = code;
    this.detail = detail;
  }
}
