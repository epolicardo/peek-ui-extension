import * as vscode from 'vscode'
import { ServiceBusProvider } from '../serviceBusProvider'
import { SbDependencyBase } from './SbDependencyBase'
import * as service from '../utils/serviceBusService'
import { SubscriptionRuntimeProperties } from '@azure/service-bus'
import { mapTopicToDep } from '../utils/dependencyMapper'

export class TopicItem extends SbDependencyBase {
  constructor(
    public readonly label: string, // name of sb/queue/topic/subscription
    public readonly connectionString: string,
    public collapsibleState: vscode.TreeItemCollapsibleState,
    public subscriptions: SubscriptionRuntimeProperties[],
  ) {
    super(label, connectionString, collapsibleState)

    this.tooltip = `${this.label}}`
    this.description = this.getDescription()
  }

  contextValue = 'childDependency'
  iconPath = new vscode.ThemeIcon('server-environment')

  getDescription = () => `${this.subscriptions?.length ?? 0} subscriptions`

  refresh = async (provider: ServiceBusProvider) => {
    this.setLoading(provider)
    const topic = await service.getTopicCustomProperties(this.connectionString, this.label)
    const dep = mapTopicToDep(topic, this.connectionString)
    this.update(dep)
    provider.refresh(this)
  }

  update = (item: TopicItem) => {
    this.subscriptions = item.subscriptions
    this.collapsibleState = item.subscriptions.length < 1 ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
    this.description = item.getDescription()
    this.iconPath = new vscode.ThemeIcon('server-environment')
  }

  createSubscription = async (provider: ServiceBusProvider) => {
    const name = await vscode.window.showInputBox({
      prompt: 'Subscription name',
      placeHolder: 'my-subscription',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Name is required'
        }
        if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
          return 'Name can only contain letters, numbers, hyphens and underscores'
        }
        return null
      },
    })

    if (!name) {
      return
    }

    try {
      await service.createSubscription(this.connectionString, this.label, name)
      await this.refresh(provider)
    }
    catch (error) {
      // Error already handled by service
    }
  }
}
