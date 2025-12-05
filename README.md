# Peek a Bus

**Peek a Bus** is a powerful Azure Service Bus management tool for VS Code. This is a modified and enhanced version of the original [Peek UI](https://github.com/Aqw0rd/peek-ui-extension) by horgen.

## About

This extension allows you to inspect, manage, and interact with Azure Service Bus queues, topics, and subscriptions directly from VS Code. 

## Features

### Original Features (from Peek UI)
- View all Queues, Topics & Subscriptions for a given Service Bus
- Transfer from deadletter
- Purge messages
- Real-time message monitoring

### New Features (Peek a Bus)
- 📁 **Category grouping** - Queues, Topics organized in expandable categories
- 💾 **Export/Import connections** - Share Service Bus connections with your team
- 📝 **Subscription management** - Create, edit, and delete subscriptions
- 🔧 **Rules management** - Manage subscription rules with SQL filters
- ⚡ **Performance optimizations** - 3-6x faster connection times with parallel loading
- ⭐ **Favorites system** - Quick access to frequently used queues/subscriptions
- 🎨 **Improved icons** - Better visual representation (queues, topics, subscriptions)

![Peeking messages](images/peek.png)

![Manage](images/transfer.png)

## Requirements

None.

## Extension Settings

None.

## Known Issues

None.

## Credits

**Original Author:** [horgen](https://github.com/Aqw0rd) - Creator of [Peek UI](https://github.com/Aqw0rd/peek-ui-extension)

**Modified by:** Emiliano Policardo (epolicardo)

This project is licensed under GPL-3.0, which allows modifications while preserving the original author's attribution.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed release history.

### 0.0.4 (Peek a Bus - Latest)
- Renamed to "Peek a Bus"
- Added category grouping for Service Bus entities
- Changed subscription icons for better visual representation
- Added version management scripts
- Restored message body scroll

---

## Original Peek UI Release History

### 0.0.3
- Fixed issue with opening subscriptions

### 0.0.2
- Fixed bug when re-opening closed webviews
- Adjusted refresh state when transferring/purging messages
- Fixed possible infinite loop when transferring messages

### 0.0.1
- Initial version of Peek UI by horgen
