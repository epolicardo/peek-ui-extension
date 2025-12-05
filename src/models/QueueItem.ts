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
      command: 'peekabus.peek-a-bus.showMessages',
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
      // Get fresh counts
      const queue = await service.getQueueRuntimeProperties(this.connectionString, this.label)
      const dep = mapQueueToDep(queue, this.connectionString)
      this.update(dep)

      if (this.activeMessageCount < 1 && this.deadLetterMessageCount < 1) {
        this.view.update({ messages: [], deadletter: [] })
        return
      }

      // Ask user to choose mode and amount
      const mode = await vscode.window.showQuickPick(
        [
          'Peek Messages (one partition, no side effects)',
          'Receive Messages (all partitions, increments delivery count)',
        ],
        {
          placeHolder: 'Choose how to retrieve messages',
          ignoreFocusOut: true
        }
      )

      if (!mode) {
        return
      }

      const amountStr = await vscode.window.showInputBox({
        prompt: `How many messages to retrieve? (Active: ${this.activeMessageCount}, Deadletter: ${this.deadLetterMessageCount})`,
        value: Math.min(this.activeMessageCount, 100).toString(),
        validateInput: (value) => {
          const num = parseInt(value)
          if (isNaN(num) || num < 1) {
            return 'Please enter a valid number greater than 0'
          }
          if (num > 1000) {
            return 'Maximum 1000 messages allowed'
          }
          return null
        },
        ignoreFocusOut: true
      })

      if (!amountStr) {
        return
      }

      const amount = parseInt(amountStr)
      const useReceiveMode = mode.startsWith('Receive')

      console.log(`[QueueItem.updateView] Fetching messages - Mode: ${mode}, Amount: ${amount}`)
      const messagesDetails = await service.peekQueueMessages(
        this.connectionString,
        this.label,
        amount,
        Math.min(this.deadLetterMessageCount, amount),
        useReceiveMode
      )
      console.log(`[QueueItem.updateView] Received messages - Active: ${messagesDetails.messages.length}, DL: ${messagesDetails.deadletter.length}`)
      this.view.update(messagesDetails)
    }
  }

  transfer = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    try {
      await ErrorHandler.withProgress(
        `Transferring deadletter messages from '${this.label}'...`,
        () => service.transferQueueDl(this.connectionString, this.label),
      )
      vscode.window.showInformationMessage(`Successfully transferred deadletter messages from queue '${this.label}'`)
      await this.refresh(provider)
    }
    catch (error) {
      provider.refresh(this)
    }
  }

  purge = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    try {
      await ErrorHandler.withProgress(
        `Purging messages from '${this.label}'...`,
        () => service.purgeQueueMessages(this.connectionString, this.label),
      )
      vscode.window.showInformationMessage(`Successfully purged messages from queue '${this.label}'`)
      await this.refresh(provider)
    }
    catch (error) {
      provider.refresh(this)
    }
  }

  purgeDl = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    try {
      await ErrorHandler.withProgress(
        `Purging deadletter from '${this.label}'...`,
        () => service.purgeQueueDeadLetter(this.connectionString, this.label),
      )
      vscode.window.showInformationMessage(`Successfully purged deadletter from queue '${this.label}'`)
      await this.refresh(provider)
    }
    catch (error) {
      provider.refresh(this)
    }
  }

  show = async () => {
    // Get fresh counts
    const queue = await service.getQueueRuntimeProperties(this.connectionString, this.label)
    const dep = mapQueueToDep(queue, this.connectionString)
    this.update(dep)

    if (this.view) {
      this.view.reveal()
      await this.updateView()
      return
    }

    let messagesDetails
    if (this.activeMessageCount < 1 && this.deadLetterMessageCount < 1) {
      messagesDetails = { messages: [], deadletter: [] }
    }
    else {
      // Ask user to choose mode and amount
      const mode = await vscode.window.showQuickPick(
        [
          'Peek Messages (one partition, no side effects)',
          'Receive Messages (all partitions, increments delivery count)',
        ],
        {
          placeHolder: 'Choose how to retrieve messages',
          ignoreFocusOut: true
        }
      )

      if (!mode) {
        return
      }

      const amountStr = await vscode.window.showInputBox({
        prompt: `How many messages to retrieve? (Active: ${this.activeMessageCount}, Deadletter: ${this.deadLetterMessageCount})`,
        value: Math.min(this.activeMessageCount, 100).toString(),
        validateInput: (value) => {
          const num = parseInt(value)
          if (isNaN(num) || num < 1) {
            return 'Please enter a valid number greater than 0'
          }
          if (num > 1000) {
            return 'Maximum 1000 messages allowed'
          }
          return null
        },
        ignoreFocusOut: true
      })

      if (!amountStr) {
        return
      }

      const amount = parseInt(amountStr)
      const useReceiveMode = mode.startsWith('Receive')

      console.log(`[QueueItem.show] Fetching messages - Mode: ${mode}, Amount: ${amount}`)
      messagesDetails = await service.peekQueueMessages(
        this.connectionString,
        this.label,
        amount,
        Math.min(this.deadLetterMessageCount, amount),
        useReceiveMode
      )
      console.log(`[QueueItem.show] Received messages - Active: ${messagesDetails.messages.length}, DL: ${messagesDetails.deadletter.length}`)
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
