# Changelog

## [0.2.1] - 2025-12-02

### Security
- Excluded sensitive files from published package (.vscodeignore updated)
- Removed service-bus-connections.json, scripts, and internal documentation from VSIX



## [0.2.0] - 2025-12-02

### Added
- Copy icon next to "Message Body" to copy body text to clipboard
- New SVG icon (pab.svg) for activity bar

### Changed
- Removed JSON syntax highlighting for cleaner display
- Simplified message body and properties formatting

### Fixed
- Duplicate "Message Body" title issue



All notable changes to "Peek a Bus" (modified version of Peek UI) will be documented in this file.

**Original Project:** [Peek UI](https://github.com/Aqw0rd/peek-ui-extension) by horgen

---

## [0.1.0] - 2025-12-02

### 🎉 MAJOR RELEASE - Complete Rebranding

This version marks the official fork and rebranding from "Peek UI" to "Peek a Bus"

### Changed - REBRANDING
- **Renamed extension** from "Peek UI" to "Peek a Bus"
- Changed namespace from `horgen.peek-ui` to `peekabus.peek-a-bus`
- Changed publisher from "horgen" to "epolicardo"
- Updated all command IDs, view IDs, and context values
- Updated repository to https://github.com/epolicardo/peek-ui-extension
- Added proper GPL-3 attribution in NOTICE file

### Added
- Comprehensive README with credits to original author
- Detailed feature comparison between original and modified version

---

## [0.0.4] - 2025-12-01

### Changed - REBRANDING
- **Renamed extension** from "Peek UI" to "Peek a Bus"
- Changed namespace from `horgen.peek-ui` to `peekabus.peek-a-bus`
- Changed publisher from "horgen" to "epolicardo"
- Updated repository to https://github.com/epolicardo/peek-ui-extension
- Added NOTICE file with proper GPL-3 attribution to original author

### Added
- Category grouping in Service Bus tree (Queues, Topics)
- Version management scripts (`npm run build:hotfix` and `npm run build:minor`)
- Export/Import connections functionality
- Subscription CRUD operations (create, edit, delete)
- Subscription rules management with SQL filters
- Favorites system for quick access

### Changed
- Subscription icon changed to `account` (👤) for better visual representation
- Performance optimization: 3-6x faster connections with parallel loading
- Restored message body scroll (max-height: 400px)

### Fixed
- Message body scroll that was lost in previous updates

---

## Original Peek UI Releases

### [0.0.3]
- Fixed issue with opening subscriptions

### [0.0.2]
- Fixed bug when re-opening closed webviews
- Adjusted refresh state when transferring/purging messages
- Fixed possible infinite loop when transferring messages

### [0.0.1]
- Initial version of Peek UI by horgen

