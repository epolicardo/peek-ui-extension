import * as vscode from 'vscode'
import { MessagesWebView } from '../views/messagesWebView'
import * as service from '../utils/serviceBusService'
import { ServiceBusProvider } from '../serviceBusProvider'
import { mapSubscriptionToDep } from '../utils/dependencyMapper'
import { IInteractableItem } from '../interfaces/IInteractableItem'
import { SbDependencyBase } from './SbDependencyBase'
import { ErrorHandler } from '../utils/errorHandler'

export class SubscriptionItem extends SbDependencyBase implements IInteractableItem {
  constructor(
    public readonly label: string,
    public readonly connectionString: string,
    public activeMessageCount: number,
    public deadLetterMessageCount: number,
    public readonly topicName: string,
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
    const subscription = await service.getSubscriptionRuntimeProperties(this.connectionString, this.topicName, this.label)
    const dep = mapSubscriptionToDep(subscription, this.connectionString)
    this.update(dep)
    await this.updateView()
    provider.refresh(this)
  }

  update = (item: SubscriptionItem) => {
    this.activeMessageCount = item.activeMessageCount
    this.deadLetterMessageCount = item.deadLetterMessageCount
    this.description = item.getDescription()
    this.iconPath = new vscode.ThemeIcon('database')
  }

  updateView = async () => {
    if (this.view) {
      const messagesDetails = await service.peekSubscriptionMessages(this.connectionString, this.topicName, this.label, this.activeMessageCount, this.deadLetterMessageCount)
      this.view.update(messagesDetails)
    }
  }

  transfer = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    try {
      await ErrorHandler.withProgress(
        `Transferring deadletter messages from subscription '${this.label}'...`,
        () => service.transferSubscriptionDl(this.connectionString, this.topicName, this.label)
      )
      vscode.window.showInformationMessage(`Successfully transferred deadletter messages from subscription '${this.label}'`)
      await this.refresh(provider)
    } catch (error) {
      provider.refresh(this)
    }
  }

  purge = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    try {
      await ErrorHandler.withProgress(
        `Purging messages from subscription '${this.label}'...`,
        () => service.purgeSubscriptionMessages(this.connectionString, this.topicName, this.label)
      )
      vscode.window.showInformationMessage(`Successfully purged messages from subscription '${this.label}'`)
      await this.refresh(provider)
    } catch (error) {
      provider.refresh(this)
    }
  }

  purgeDl = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    try {
      await ErrorHandler.withProgress(
        `Purging deadletter from subscription '${this.label}'...`,
        () => service.purgeSubscriptionDeadletter(this.connectionString, this.topicName, this.label)
      )
      vscode.window.showInformationMessage(`Successfully purged deadletter from subscription '${this.label}'`)
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
      messagesDetails = await service.peekSubscriptionMessages(this.connectionString, this.topicName, this.label, this.activeMessageCount, this.deadLetterMessageCount)
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
        'subscription',
        this.topicName,
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
