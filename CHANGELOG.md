# Changelog

All notable changes to BrowserMCP Enhanced will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-30

### 🎉 First Production Release

This is the first stable, production-ready release of BrowserMCP Enhanced. After extensive development and testing, we're confident in the reliability and security of this browser automation solution.

### Added
- **RPC-based Safe Mode Execution**: Completely redesigned JavaScript execution with sandboxed iframe isolation
- **Async API Methods**: All safe mode methods now use async/await patterns for better control
  - `await api.getText(selector)` - Get element text content
  - `await api.exists(selector)` - Check element existence
  - `await api.click(selector)` - Click elements safely
  - `await api.setValue(selector, value)` - Set input values
  - `await api.getPageInfo()` - Get page metadata
- **Enhanced Security**: Message-passing architecture prevents direct DOM access in safe mode
- **Smart Deployment Script**: New deployment system with version checking and rollback capability
- **Comprehensive Documentation**: Full API documentation and usage examples

### Changed
- **Execution Architecture**: Replaced AST-based approach with robust RPC system
- **Tool Descriptions**: Updated browser_execute_js hints to clearly distinguish safe vs unsafe modes
- **Error Handling**: Improved error messages and recovery mechanisms
- **Chrome Extension**: Enhanced manifest for better compatibility

### Fixed
- Safe mode execution failures that required unsafe mode workarounds
- IIFE wrapper confusion - now only required for unsafe mode
- WebSocket reconnection issues in Chrome extension
- Element detection in dynamically loaded content
- Console log capture in sandboxed environments

### Security
- Sandboxed iframe execution prevents malicious code execution
- Controlled DOM access through validated API methods
- Clear separation between safe and unsafe execution contexts

### Technical Details
- **Architecture**: RPC-based message passing with MessageChannel
- **Compatibility**: Chrome 120+, Node.js 20+
- **Performance**: Optimized token usage, <100ms execution overhead
- **Testing**: Extensively tested on seznam.cz, CodeMirror, Monaco Editor

## [0.9.5] - 2025-01-29

### Added
- Initial RPC executor implementation
- Code executor RPC module

### Changed
- Switched from AST-based to RPC-based execution

## [0.9.4] - 2025-01-28

### Added
- AST-based code analysis (later replaced)
- Enhanced element validation

### Fixed
- Click handling for OAuth popups

## [0.9.3] - 2025-01-27

### Added
- Component-based element capture
- Pagination support for large pages
- Enhanced debugging capabilities

### Changed
- Improved element selection accuracy
- Better accessibility support

## [0.9.2] - 2025-01-26

### Added
- Tab management improvements
- Network monitoring capabilities

### Fixed
- Memory leaks in long-running sessions

## [0.9.1] - 2025-01-25

### Added
- Initial enhanced version fork
- Smart click detection
- OAuth flow handling

### Changed
- Improved error messages
- Better WebSocket handling

## [0.9.0] - 2025-01-24

### Added
- Initial release based on original BrowserMCP
- Basic browser automation
- Chrome extension
- MCP server implementation

---

## Version History Summary

| Version | Date | Type | Summary |
|---------|------|------|---------|
| 1.0.0 | 2025-01-30 | Major | First production release with RPC-based safe mode |
| 0.9.5 | 2025-01-29 | Minor | RPC executor implementation |
| 0.9.4 | 2025-01-28 | Minor | AST-based analysis (replaced) |
| 0.9.3 | 2025-01-27 | Minor | Component-based capture |
| 0.9.2 | 2025-01-26 | Patch | Tab management fixes |
| 0.9.1 | 2025-01-25 | Minor | Enhanced fork creation |
| 0.9.0 | 2025-01-24 | Minor | Initial release |

## Upgrade Guide

### From 0.9.x to 1.0.0

1. **Update Chrome Extension**: The new RPC executor requires the updated extension
2. **Review API Usage**: Safe mode API calls now require `await`
3. **Update Scripts**: Remove IIFE wrappers from safe mode code
4. **Test Thoroughly**: The execution model has fundamentally changed

### Breaking Changes in 1.0.0

- Safe mode API methods are now async (require `await`)
- IIFE wrappers only needed for unsafe mode
- Removed AST-based executor completely
- Changed internal message passing structure

## Future Roadmap

### v1.1.0 (Planned)
- Pattern recognition and automation hints
- Enhanced form detection
- Improved error recovery

### v1.2.0 (Planned)
- Advanced debugging capabilities
- Performance profiling
- Memory optimization

### v2.0.0 (Planned)
- Multi-browser support (Firefox, Safari)
- Headless mode improvements
- Cloud deployment options

[1.0.0]: https://github.com/david-strejc/browsermcp-enhanced/releases/tag/v1.0.0
[0.9.5]: https://github.com/david-strejc/browsermcp-enhanced/releases/tag/v0.9.5
[0.9.4]: https://github.com/david-strejc/browsermcp-enhanced/releases/tag/v0.9.4
[0.9.3]: https://github.com/david-strejc/browsermcp-enhanced/releases/tag/v0.9.3
[0.9.2]: https://github.com/david-strejc/browsermcp-enhanced/releases/tag/v0.9.2
[0.9.1]: https://github.com/david-strejc/browsermcp-enhanced/releases/tag/v0.9.1
[0.9.0]: https://github.com/david-strejc/browsermcp-enhanced/releases/tag/v0.9.0