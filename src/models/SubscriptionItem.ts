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
      command: 'peekabus.peek-a-bus.showMessages',
      title: '',
      arguments: [this],
    }
    this.view = undefined
  }

  contextValue = 'interactableDependency'
  iconPath = new vscode.ThemeIcon('account')
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
    this.iconPath = new vscode.ThemeIcon('account')
  }

  updateView = async () => {
    if (this.view) {
      // Get fresh counts
      const subscription = await service.getSubscriptionRuntimeProperties(this.connectionString, this.topicName, this.label)
      const dep = mapSubscriptionToDep(subscription, this.connectionString)
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
          ignoreFocusOut: true,
        },
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
        ignoreFocusOut: true,
      })

      if (!amountStr) {
        return
      }

      const amount = parseInt(amountStr)
      const useReceiveMode = mode.startsWith('Receive')

      console.log(`[SubscriptionItem.updateView] Fetching messages - Mode: ${mode}, Amount: ${amount}`)
      const messagesDetails = await service.peekSubscriptionMessages(
        this.connectionString,
        this.topicName,
        this.label,
        amount,
        Math.min(this.deadLetterMessageCount, amount),
        useReceiveMode,
      )
      console.log(`[SubscriptionItem.updateView] Received messages - Active: ${messagesDetails.messages.length}, DL: ${messagesDetails.deadletter.length}`)
      this.view.update(messagesDetails)
    }
  }

  transfer = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    try {
      await ErrorHandler.withProgress(
        `Transferring deadletter messages from subscription '${this.label}'...`,
        () => service.transferSubscriptionDl(this.connectionString, this.topicName, this.label),
      )
      vscode.window.showInformationMessage(`Successfully transferred deadletter messages from subscription '${this.label}'`)
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
        `Purging messages from subscription '${this.label}'...`,
        () => service.purgeSubscriptionMessages(this.connectionString, this.topicName, this.label),
      )
      vscode.window.showInformationMessage(`Successfully purged messages from subscription '${this.label}'`)
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
        `Purging deadletter from subscription '${this.label}'...`,
        () => service.purgeSubscriptionDeadletter(this.connectionString, this.topicName, this.label),
      )
      vscode.window.showInformationMessage(`Successfully purged deadletter from subscription '${this.label}'`)
      await this.refresh(provider)
    }
    catch (error) {
      provider.refresh(this)
    }
  }

  show = async () => {
    // Get fresh counts
    const subscription = await service.getSubscriptionRuntimeProperties(this.connectionString, this.topicName, this.label)
    const dep = mapSubscriptionToDep(subscription, this.connectionString)
    this.update(dep)
    console.log(`[SubscriptionItem.show] After update - Active: ${this.activeMessageCount}, DL: ${this.deadLetterMessageCount}`)

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
          ignoreFocusOut: true,
        },
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
        ignoreFocusOut: true,
      })

      if (!amountStr) {
        return
      }

      const amount = parseInt(amountStr)
      const useReceiveMode = mode.startsWith('Receive')

      console.log(`[SubscriptionItem.show] Fetching messages - Mode: ${mode}, Amount: ${amount}`)
      messagesDetails = await service.peekSubscriptionMessages(
        this.connectionString,
        this.topicName,
        this.label,
        amount,
        Math.min(this.deadLetterMessageCount, amount),
        useReceiveMode,
      )
      console.log(`[SubscriptionItem.show] Received messages - Active: ${messagesDetails.messages.length}, DL: ${messagesDetails.deadletter.length}`)
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
      this.iconPath = new vscode.ThemeIcon('account')
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

  editSubscription = async (provider: ServiceBusProvider) => {
    const options = ['Max Delivery Count', 'Lock Duration', 'Default TTL', 'Dead Letter on Expiration']
    const choice = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select property to edit',
    })

    if (!choice) {
      return
    }

    try {
      if (choice === 'Max Delivery Count') {
        const value = await vscode.window.showInputBox({
          prompt: 'Max Delivery Count (1-2000)',
          placeHolder: '10',
          validateInput: (v) => {
            const num = parseInt(v)
            return isNaN(num) || num < 1 || num > 2000 ? 'Must be between 1 and 2000' : null
          },
        })
        if (value) {
          await service.updateSubscription(this.connectionString, this.topicName, this.label, {
            maxDeliveryCount: parseInt(value),
          })
        }
      }
      else if (choice === 'Lock Duration') {
        const value = await vscode.window.showInputBox({
          prompt: 'Lock Duration (ISO 8601 duration, e.g., PT1M for 1 minute)',
          placeHolder: 'PT1M',
        })
        if (value) {
          await service.updateSubscription(this.connectionString, this.topicName, this.label, {
            lockDuration: value,
          })
        }
      }
      else if (choice === 'Default TTL') {
        const value = await vscode.window.showInputBox({
          prompt: 'Default Message Time To Live (ISO 8601 duration, e.g., P7D for 7 days)',
          placeHolder: 'P7D',
        })
        if (value) {
          await service.updateSubscription(this.connectionString, this.topicName, this.label, {
            defaultMessageTimeToLive: value,
          })
        }
      }
      else if (choice === 'Dead Letter on Expiration') {
        const value = await vscode.window.showQuickPick(['true', 'false'], {
          placeHolder: 'Enable dead lettering on message expiration?',
        })
        if (value) {
          await service.updateSubscription(this.connectionString, this.topicName, this.label, {
            deadLetteringOnMessageExpiration: value === 'true',
          })
        }
      }
      await this.refresh(provider)
    }
    catch (error) {
      // Error already handled
    }
  }

  deleteSubscription = async (provider: ServiceBusProvider) => {
    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete subscription '${this.label}'? This action cannot be undone.`,
      { modal: true },
      'Delete',
    )

    if (confirm !== 'Delete') {
      return
    }

    try {
      await service.deleteSubscription(this.connectionString, this.topicName, this.label)
      provider.refresh()
    }
    catch (error) {
      // Error already handled
    }
  }

  manageRules = async () => {
    try {
      const rules = await service.listSubscriptionRules(this.connectionString, this.topicName, this.label)

      const items = [
        { label: '$(add) Create New Rule', id: '__create__' },
        ...rules.map(r => ({
          label: r.name,
          description: r.filter?.sqlExpression || 'No filter',
          id: r.name,
        })),
      ]

      const selection = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a rule to delete or create a new one',
      })

      if (!selection) {
        return
      }

      if (selection.id === '__create__') {
        await this.createRule()
      }
      else {
        const action = await vscode.window.showQuickPick(['Delete Rule'], {
          placeHolder: `Actions for rule '${selection.id}'`,
        })

        if (action === 'Delete Rule') {
          await this.deleteRule(selection.id)
        }
      }
    }
    catch (error) {
      // Error already handled
    }
  }

  private createRule = async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Rule name',
      placeHolder: 'my-rule',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Name is required'
        }
        return null
      },
    })

    if (!name) {
      return
    }

    const filter = await vscode.window.showInputBox({
      prompt: 'SQL Filter Expression (e.g., "1=1" for all messages, "user=\'admin\'" for specific property)',
      placeHolder: '1=1',
      value: '1=1',
    })

    if (!filter) {
      return
    }

    try {
      await service.createSubscriptionRule(this.connectionString, this.topicName, this.label, name, filter)
    }
    catch (error) {
      // Error already handled
    }
  }

  private deleteRule = async (ruleName: string) => {
    const confirm = await vscode.window.showWarningMessage(
      `Delete rule '${ruleName}'?`,
      'Delete',
      'Cancel',
    )

    if (confirm === 'Delete') {
      try {
        await service.deleteSubscriptionRule(this.connectionString, this.topicName, this.label, ruleName)
      }
      catch (error) {
        // Error already handled
      }
    }
  }
}
