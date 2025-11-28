import * as vscode from 'vscode'
import { ServiceBusProvider } from '../serviceBusProvider'
import { SbDependencyBase } from './SbDependencyBase'
import * as service from '../utils/serviceBusService'
import { IInteractableItem } from '../interfaces/IInteractableItem'
import { MessagesWebView } from '../views/messagesWebView'
import { mapQueueToDep } from '../utils/dependencyMapper'
import { ErrorHandler } from '../utils/errorHandler'

export class QueueItem extends SbDependencyBase implements IInteractableItem {
  constructor(
    public readonly label: string,
    public readonly connectionString: string,
    public activeMessageCount: number,
    public deadLetterMessageCount: number,
  ) {
    super(label, connectionString, vscode.TreeItemCollapsibleState.None)

    this.tooltip = `${this.label}}`
    this.description = this.getDescription()
    this.command = {
      command: 'horgen.peek-ui.showMessages',
      title: '',
      arguments: [this],
    }
    this.view = undefined
  }

  contextValue = 'interactableDependency'
  iconPath = new vscode.ThemeIcon('database')
  view: MessagesWebView | undefined

  getDescription = () => `${this.activeMessageCount} | ${this.deadLetterMessageCount}`

  refresh = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    const queue = await service.getQueueRuntimeProperties(this.connectionString, this.label)
    const dep = mapQueueToDep(queue, this.connectionString)
    this.update(dep)
    await this.updateView()
    provider.refresh(this)
  }

  update = (item: QueueItem) => {
    this.activeMessageCount = item.activeMessageCount
    this.deadLetterMessageCount = item.deadLetterMessageCount
    this.description = item.getDescription()
    this.iconPath = new vscode.ThemeIcon('database')
  }

  updateView = async () => {
    if (this.view) {
      const messagesDetails = await service.peekQueueMessages(this.connectionString, this.label, this.activeMessageCount, this.deadLetterMessageCount)
      this.view.update(messagesDetails)
    }
  }

  transfer = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    try {
      await ErrorHandler.withProgress(
        `Transferring deadletter messages from '${this.label}'...`,
        () => service.transferQueueDl(this.connectionString, this.label)
      )
      vscode.window.showInformationMessage(`Successfully transferred deadletter messages from queue '${this.label}'`)
      await this.refresh(provider)
    } catch (error) {
      provider.refresh(this)
    }
  }

  purge = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    try {
      await ErrorHandler.withProgress(
        `Purging messages from '${this.label}'...`,
        () => service.purgeQueueMessages(this.connectionString, this.label)
      )
      vscode.window.showInformationMessage(`Successfully purged messages from queue '${this.label}'`)
      await this.refresh(provider)
    } catch (error) {
      provider.refresh(this)
    }
  }

  purgeDl = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    try {
      await ErrorHandler.withProgress(
        `Purging deadletter from '${this.label}'...`,
        () => service.purgeQueueDeadLetter(this.connectionString, this.label)
      )
      vscode.window.showInformationMessage(`Successfully purged deadletter from queue '${this.label}'`)
      await this.refresh(provider)
    } catch (error) {
      provider.refresh(this)
    }
  }

  show = async () => {
    if (this.view) {
      this.view.reveal()
      return
    }

    let messagesDetails
    if (this.activeMessageCount < 1 && this.deadLetterMessageCount < 1) {
      messagesDetails = { messages: [], deadletter: [] }
    }
    else {
      messagesDetails = await service.peekQueueMessages(this.connectionString, this.label, this.activeMessageCount, this.deadLetterMessageCount)
    }

    this.view = new MessagesWebView(this, messagesDetails)
    this.view.show()
    this.view.panel?.onDidDispose(() => {
      this.view = undefined
    })
  }

  toggleMonitoring = async (provider: ServiceBusProvider) => {
    const isMonitoring = service.isMonitoring(this.connectionString, this.label)

    if (isMonitoring) {
      await service.stopMonitoring(this.connectionString, this.label)
      this.iconPath = new vscode.ThemeIcon('database')
    }
    else {
      await service.startMonitoring(
        this.connectionString,
        this.label,
        'queue',
        undefined,
        async () => {
          // Refresh when new message arrives
          await this.refresh(provider)
        },
      )
      this.iconPath = new vscode.ThemeIcon('bell', new vscode.ThemeColor('charts.green'))
    }
    provider.refresh(this)
  }
}
