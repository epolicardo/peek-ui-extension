import * as vscode from 'vscode'
import * as service from './utils/serviceBusService'
import { IServiceBusItem } from './interfaces/IServiceBusItem'
import { mapQueueToDep, mapSubscriptionToDep, mapTopicToDep, mapUnconnectedSbToDep } from './utils/dependencyMapper'
import { SbDependencyBase } from './models/SbDependencyBase'
import { ServiceBusItem } from './models/ServiceBusItem'
import { TopicItem } from './models/TopicItem'
import { CategoryItem } from './models/CategoryItem'
import { ErrorHandler } from './utils/errorHandler'

export class ServiceBusProvider implements vscode.TreeDataProvider<SbDependencyBase> {
  private _onDidChangeTreeData: vscode.EventEmitter<SbDependencyBase | undefined | void> = new vscode.EventEmitter<SbDependencyBase | undefined | void>()
  readonly onDidChangeTreeData: vscode.Event<SbDependencyBase | undefined | void> = this._onDidChangeTreeData.event

  state: vscode.Memento

  constructor(private context: vscode.ExtensionContext) {
    this.state = context.globalState
  }

  refresh(item: SbDependencyBase | undefined | void): void {
    this._onDidChangeTreeData.fire(item)
  }

  async editConnectionAlias(node: ServiceBusItem): Promise<void> {
    const current = this.state.get<IServiceBusItem[]>('peekabus.peek-a-bus.state', [])
    const item = current.find(c => c.name === node.label || c.alias === node.label)

    if (!item) {
      vscode.window.showErrorMessage('Connection not found')
      return
    }

    const newAlias = await vscode.window.showInputBox({
      prompt: 'Enter new alias for this connection',
      placeHolder: 'e.g., DEV, QA, Production',
      value: item.alias || '',
      ignoreFocusOut: true,
    })

    if (newAlias === undefined) {
      return // User cancelled
    }

    // Update the item
    item.alias = newAlias || undefined
    await this.state.update('peekabus.peek-a-bus.state', current)

    // Update alias mapping
    if (newAlias) {
      await this.context.globalState.update(`peekabus.peek-a-bus.alias.${item.name}`, newAlias)
    }
    else {
      await this.context.globalState.update(`peekabus.peek-a-bus.alias.${item.name}`, undefined)
    }

    vscode.window.showInformationMessage(`Connection alias updated to '${newAlias || item.name}'`)
    this.refresh()
  }

  async removeConnection(serviceBusName: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to remove the connection to '${serviceBusName}'?`,
      { modal: true },
      'Yes',
      'No',
    )

    if (confirm !== 'Yes') {
      return
    }

    try {
      const current = this.state.get<IServiceBusItem[]>('peekabus.peek-a-bus.state', [])
      const item = current.find(c => c.name === serviceBusName)

      if (item) {
        // Get connection string to close the client
        const connectionString = await this.context.secrets.get(`peekabus.peek-a-bus.connection.${serviceBusName}`)

        // Close the Service Bus client
        if (connectionString) {
          const { ServiceBusClientManager } = await import('./utils/serviceBusClientManager.js')
          await ServiceBusClientManager.closeClient(connectionString)
        } // Remove from secrets
        await this.context.secrets.delete(`peekabus.peek-a-bus.connection.${serviceBusName}`)

        // Remove from state
        const updated = current.filter(c => c.name !== serviceBusName)
        await this.state.update('peekabus.peek-a-bus.state', updated)

        vscode.window.showInformationMessage(`Connection to '${serviceBusName}' removed successfully`)
        this.refresh()
      }
    }
    catch (error) {
      ErrorHandler.handleError(error, `removing connection to '${serviceBusName}'`)
    }
  }

  async exportConnections(): Promise<void> {
    try {
      const current = this.state.get<IServiceBusItem[]>('peekabus.peek-a-bus.state', [])

      if (current.length === 0) {
        vscode.window.showInformationMessage('No connections to export')
        return
      }

      const exportData = []
      for (const item of current) {
        const connectionString = await this.context.secrets.get(`peekabus.peek-a-bus.connection.${item.name}`)
        if (connectionString) {
          exportData.push({
            name: item.name,
            alias: item.alias,
            connectionString,
          })
        }
      }

      const exportJson = JSON.stringify(exportData, null, 2)

      // Show save dialog
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('service-bus-connections.json'),
        filters: {
          'JSON Files': ['json'],
          'All Files': ['*'],
        },
      })

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(exportJson, 'utf8'))
        vscode.window.showInformationMessage(`Exported ${exportData.length} connection(s) to ${uri.fsPath}`)
      }
    }
    catch (error) {
      ErrorHandler.handleError(error, 'exporting connections')
    }
  }

  async importConnections(): Promise<void> {
    try {
      // Show open dialog
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
          'JSON Files': ['json'],
          'All Files': ['*'],
        },
        openLabel: 'Import',
      })

      if (!uris || uris.length === 0) {
        return
      }

      const fileContent = await vscode.workspace.fs.readFile(uris[0])
      const importData = JSON.parse(fileContent.toString())

      if (!Array.isArray(importData)) {
        vscode.window.showErrorMessage('Invalid import file format')
        return
      }

      const current = this.state.get<IServiceBusItem[]>('peekabus.peek-a-bus.state', [])
      let imported = 0
      let skipped = 0

      for (const item of importData) {
        if (!item.name || !item.connectionString) {
          continue
        }

        // Check if already exists
        if (current.find(c => c.name === item.name)) {
          skipped++
          continue
        }

        // Validate connection string
        const validationError = ErrorHandler.validateConnectionString(item.connectionString)
        if (validationError) {
          vscode.window.showWarningMessage(`Skipping ${item.name}: ${validationError}`)
          skipped++
          continue
        }

        // Store connection string
        await this.context.secrets.store(`peekabus.peek-a-bus.connection.${item.name}`, item.connectionString)

        // Store metadata
        current.push({
          name: item.name,
          alias: item.alias,
          connectionString: '',
        })

        // Store alias if provided
        if (item.alias) {
          await this.context.globalState.update(`peekabus.peek-a-bus.alias.${item.name}`, item.alias)
        }

        imported++
      }

      await this.state.update('peekabus.peek-a-bus.state', current)

      vscode.window.showInformationMessage(
        `Import complete: ${imported} connection(s) imported, ${skipped} skipped`,
      )
      this.refresh()
    }
    catch (error) {
      ErrorHandler.handleError(error, 'importing connections')
    }
  }

  async addConnection(): Promise<void> {
    const input = await vscode.window.showInputBox({
      prompt: 'Service Bus Connection String',
      placeHolder: 'Endpoint=sb://your-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...',
      ignoreFocusOut: true,
      password: true, // Hide the connection string input
    })

    if (!input) {
      return
    }

    // Ask for an optional alias
    const alias = await vscode.window.showInputBox({
      prompt: 'Connection Alias (optional)',
      placeHolder: 'e.g., DEV, QA, Production',
      ignoreFocusOut: true,
    })

    // Validate connection string format
    const validationError = ErrorHandler.validateConnectionString(input)
    if (validationError) {
      vscode.window.showErrorMessage(validationError)
      return
    }

    try {
      // Show progress while connecting
      const sbInfo = await ErrorHandler.withProgress(
        'Connecting to Service Bus...',
        () => service.getServiceBusInfo(input),
      )

      const current = this.state.get<IServiceBusItem[]>('peekabus.peek-a-bus.state', [])

      // Check if connection already exists
      if (current.find(c => c.name === sbInfo.serviceBusName)) {
        vscode.window.showWarningMessage(`Service Bus '${sbInfo.serviceBusName}' is already connected.`)
        return
      }

      // Store connection string securely in secrets
      await this.context.secrets.store(`peekabus.peek-a-bus.connection.${sbInfo.serviceBusName}`, input)

      // Store the name and optional alias in state (not the connection string)
      const updated = [...current, { connectionString: '', name: sbInfo.serviceBusName, alias: alias || undefined }]
      await this.state.update('peekabus.peek-a-bus.state', updated)

      // Store alias mapping for favorites
      if (alias) {
        await this.context.globalState.update(`peekabus.peek-a-bus.alias.${sbInfo.serviceBusName}`, alias)
      }

      const displayName = alias || sbInfo.serviceBusName
      vscode.window.showInformationMessage(`Successfully connected to Service Bus '${displayName}'`)
      this.refresh()
    }
    catch (error) {
      // Error already handled by ErrorHandler in service
    }
  }

  getTreeItem(element: SbDependencyBase): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element
  }

  async getChildren(element?: SbDependencyBase): Promise<SbDependencyBase[]> {
    if (!element) {
      const sbItems = this.state.get<IServiceBusItem[]>('peekabus.peek-a-bus.state', [])

      // Retrieve connection strings from secrets
      const depsPromises = sbItems.map(async (item) => {
        const connectionString = await this.context.secrets.get(`peekabus.peek-a-bus.connection.${item.name}`)
        const displayName = item.alias || item.name
        const sbItem = mapUnconnectedSbToDep(displayName, connectionString || '')
        // Store the original name in the item for later use
        if (sbItem) {
          (sbItem as any).originalName = item.name
        }
        return sbItem
      })

      const deps = await Promise.all(depsPromises)
      vscode.commands.executeCommand('setContext', 'peekabus.peek-a-bus:isInitialized', true)
      return deps.flat()
    }

    if (element instanceof ServiceBusItem) {
      if (element.isConnected) {
        const categories: SbDependencyBase[] = []

        // Queues category
        if (element.queues && element.queues.length > 0) {
          const category = new CategoryItem('Queues', element.queues.length, 'inbox')
            ; (category as any).parentItem = element
          ; (category as any).itemType = 'queues'
          categories.push(category)
        }

        // Topics category
        if (element.topics && element.topics.length > 0) {
          const category = new CategoryItem('Topics', element.topics.length, 'symbol-namespace')
            ; (category as any).parentItem = element
          ; (category as any).itemType = 'topics'
          categories.push(category)
        }

        // Future: Event Hubs, Notification Hubs, Relays categories can be added here

        return Promise.resolve(categories)
      }
      return Promise.resolve([])
    }

    if (element instanceof CategoryItem) {
      const parentItem = (element as any).parentItem as ServiceBusItem
      const itemType = (element as any).itemType

      if (itemType === 'queues' && parentItem.queues) {
        return Promise.resolve(parentItem.queues.map(queue => mapQueueToDep(queue, parentItem.connectionString)))
      }

      if (itemType === 'topics' && parentItem.topics) {
        return Promise.resolve(parentItem.topics.map(topic => mapTopicToDep(topic, parentItem.connectionString)))
      }

      return Promise.resolve([])
    }

    if (element instanceof TopicItem) {
      const subscriptions = element.subscriptions ? element.subscriptions.map(sub => mapSubscriptionToDep(sub, element.connectionString)) : []
      return Promise.resolve(subscriptions)
    }

    return Promise.resolve([])
  }
}
