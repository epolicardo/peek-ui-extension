import * as vscode from 'vscode'
import * as service from './utils/serviceBusService'
import { IServiceBusItem } from './interfaces/IServiceBusItem'
import { mapQueueToDep, mapSubscriptionToDep, mapTopicToDep, mapUnconnectedSbToDep } from './utils/dependencyMapper'
import { SbDependencyBase } from './models/SbDependencyBase'
import { ServiceBusItem } from './models/ServiceBusItem'
import { TopicItem } from './models/TopicItem'
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
    const current = this.state.get<IServiceBusItem[]>('horgen.peek-ui.state', [])
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
    await this.state.update('horgen.peek-ui.state', current)

    // Update alias mapping
    if (newAlias) {
      await this.context.globalState.update(`horgen.peek-ui.alias.${item.name}`, newAlias)
    }
    else {
      await this.context.globalState.update(`horgen.peek-ui.alias.${item.name}`, undefined)
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
      const current = this.state.get<IServiceBusItem[]>('horgen.peek-ui.state', [])
      const item = current.find(c => c.name === serviceBusName)

      if (item) {
        // Get connection string to close the client
        const connectionString = await this.context.secrets.get(`horgen.peek-ui.connection.${serviceBusName}`)

        // Close the Service Bus client
        if (connectionString) {
          const { ServiceBusClientManager } = await import('./utils/serviceBusClientManager.js')
          await ServiceBusClientManager.closeClient(connectionString)
        } // Remove from secrets
        await this.context.secrets.delete(`horgen.peek-ui.connection.${serviceBusName}`)

        // Remove from state
        const updated = current.filter(c => c.name !== serviceBusName)
        await this.state.update('horgen.peek-ui.state', updated)

        vscode.window.showInformationMessage(`Connection to '${serviceBusName}' removed successfully`)
        this.refresh()
      }
    }
    catch (error) {
      ErrorHandler.handleError(error, `removing connection to '${serviceBusName}'`)
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

      const current = this.state.get<IServiceBusItem[]>('horgen.peek-ui.state', [])

      // Check if connection already exists
      if (current.find(c => c.name === sbInfo.serviceBusName)) {
        vscode.window.showWarningMessage(`Service Bus '${sbInfo.serviceBusName}' is already connected.`)
        return
      }

      // Store connection string securely in secrets
      await this.context.secrets.store(`horgen.peek-ui.connection.${sbInfo.serviceBusName}`, input)

      // Store the name and optional alias in state (not the connection string)
      const updated = [...current, { connectionString: '', name: sbInfo.serviceBusName, alias: alias || undefined }]
      await this.state.update('horgen.peek-ui.state', updated)

      // Store alias mapping for favorites
      if (alias) {
        await this.context.globalState.update(`horgen.peek-ui.alias.${sbInfo.serviceBusName}`, alias)
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
      const sbItems = this.state.get<IServiceBusItem[]>('horgen.peek-ui.state', [])

      // Retrieve connection strings from secrets
      const depsPromises = sbItems.map(async (item) => {
        const connectionString = await this.context.secrets.get(`horgen.peek-ui.connection.${item.name}`)
        const displayName = item.alias || item.name
        const sbItem = mapUnconnectedSbToDep(displayName, connectionString || '')
        // Store the original name in the item for later use
        if (sbItem) {
          (sbItem as any).originalName = item.name
        }
        return sbItem
      })

      const deps = await Promise.all(depsPromises)
      vscode.commands.executeCommand('setContext', 'horgen.peek-ui:isInitialized', true)
      return deps.flat()
    }

    if (element instanceof ServiceBusItem) {
      if (element.isConnected) {
        const queues: SbDependencyBase[] = element.queues ? element.queues.map(queue => mapQueueToDep(queue, element.connectionString)) : []
        const topics: SbDependencyBase[] = element.topics ? element.topics.map(topic => mapTopicToDep(topic, element.connectionString)) : []
        return Promise.resolve(queues.concat(topics))
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
