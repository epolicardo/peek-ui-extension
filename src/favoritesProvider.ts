import * as vscode from 'vscode'
import { IFavoriteItem } from './interfaces/IFavoriteItem'
import { QueueItem } from './models/QueueItem'
import { TopicItem } from './models/TopicItem'
import { SubscriptionItem } from './models/SubscriptionItem'
import * as service from './utils/serviceBusService'
import { ErrorHandler } from './utils/errorHandler'

class FavoriteTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly favoriteItem?: IFavoriteItem,
    public readonly children?: FavoriteTreeItem[],
  ) {
    super(label, collapsibleState)

    if (contextValue === 'favoriteEnvironment') {
      this.iconPath = new vscode.ThemeIcon('server-environment')
    }
    else if (contextValue === 'favoriteSection') {
      this.iconPath = new vscode.ThemeIcon('folder')
    }
    else if (contextValue === 'favoriteTopicGroup') {
      this.iconPath = new vscode.ThemeIcon('symbol-namespace')
    }
    else if (contextValue === 'favoriteServiceBus') {
      this.iconPath = new vscode.ThemeIcon('server-environment')
    }
    else if (contextValue === 'favoriteTopic') {
      this.iconPath = new vscode.ThemeIcon('symbol-namespace')
      // If this is a favorite topic (not just a grouping node), add command
      if (favoriteItem) {
        this.command = {
          command: 'peekabus.peek-a-bus.openFavorite',
          title: 'Open Favorite',
          arguments: [favoriteItem],
        }
      }
    }
    else if (contextValue === 'favoriteQueue') {
      this.iconPath = new vscode.ThemeIcon('database')
      this.command = {
        command: 'peekabus.peek-a-bus.openFavorite',
        title: 'Open Favorite',
        arguments: [favoriteItem],
      }
    }
    else if (contextValue === 'favoriteSubscription') {
      this.iconPath = new vscode.ThemeIcon('database')
      this.command = {
        command: 'peekabus.peek-a-bus.openFavorite',
        title: 'Open Favorite',
        arguments: [favoriteItem],
      }
    }
  }
}

export class FavoritesProvider implements vscode.TreeDataProvider<FavoriteTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FavoriteTreeItem | undefined | void> = new vscode.EventEmitter<FavoriteTreeItem | undefined | void>()
  readonly onDidChangeTreeData: vscode.Event<FavoriteTreeItem | undefined | void> = this._onDidChangeTreeData.event

  constructor(private context: vscode.ExtensionContext) { }

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: FavoriteTreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: FavoriteTreeItem): Promise<FavoriteTreeItem[]> {
    if (!element) {
      // Root level: group by Service Bus environment
      const favorites = this.context.globalState.get<IFavoriteItem[]>('peekabus.peek-a-bus.favorites', [])
      console.log(`[Favorites] Loading favorites:`, favorites.length, favorites)

      if (favorites.length === 0) {
        return []
      }

      // Group favorites by Service Bus
      const grouped = new Map<string, IFavoriteItem[]>()
      for (const fav of favorites) {
        if (!grouped.has(fav.serviceBusName)) {
          grouped.set(fav.serviceBusName, [])
        }
        grouped.get(fav.serviceBusName)!.push(fav)
      }

      // Create environment nodes
      const envNodesPromises = Array.from(grouped.entries()).map(async ([sbName, items]) => {
        // Get alias if exists
        const alias = await this.context.globalState.get<string>(`peekabus.peek-a-bus.alias.${sbName}`)
        const displayName = alias || sbName
        const children = this.createSectionNodes(items)

        return new FavoriteTreeItem(
          `${displayName} (${items.length})`,
          vscode.TreeItemCollapsibleState.Expanded,
          'favoriteEnvironment',
          undefined,
          children,
        )
      })

      const envNodes = await Promise.all(envNodesPromises)
      return envNodes
    }

    // Return children if they exist
    return element.children || []
  }

  private createSectionNodes(favorites: IFavoriteItem[]): FavoriteTreeItem[] {
    const sections: FavoriteTreeItem[] = []
    const queues = favorites.filter(f => f.type === 'queue')
    const topics = favorites.filter(f => f.type === 'topic')
    const subscriptions = favorites.filter(f => f.type === 'subscription')

    if (queues.length > 0) {
      const queueItems = queues.map(q => new FavoriteTreeItem(
        q.name,
        vscode.TreeItemCollapsibleState.None,
        'favoriteQueue',
        q,
      ))
      sections.push(new FavoriteTreeItem(
        `Queues (${queues.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'favoriteSection',
        undefined,
        queueItems,
      ))
    }

    if (topics.length > 0) {
      const topicItems = topics.map(t => new FavoriteTreeItem(
        t.name,
        vscode.TreeItemCollapsibleState.None,
        'favoriteTopic',
        t,
      ))
      sections.push(new FavoriteTreeItem(
        `Topics (${topics.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'favoriteSection',
        undefined,
        topicItems,
      ))
    }

    if (subscriptions.length > 0) {
      // Group subscriptions by topic
      const subsByTopic = new Map<string, IFavoriteItem[]>()
      for (const sub of subscriptions) {
        if (!sub.topicName) {
          continue
        }
        if (!subsByTopic.has(sub.topicName)) {
          subsByTopic.set(sub.topicName, [])
        }
        subsByTopic.get(sub.topicName)!.push(sub)
      }

      const subscriptionItems: FavoriteTreeItem[] = []
      for (const [topicName, subs] of subsByTopic.entries()) {
        const subItems = subs.map(s => new FavoriteTreeItem(
          s.name,
          vscode.TreeItemCollapsibleState.None,
          'favoriteSubscription',
          s,
        ))
        subscriptionItems.push(new FavoriteTreeItem(
          topicName,
          vscode.TreeItemCollapsibleState.Collapsed,
          'favoriteTopicGroup',
          undefined,
          subItems,
        ))
      }

      sections.push(new FavoriteTreeItem(
        `Subscriptions (${subscriptions.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'favoriteSection',
        undefined,
        subscriptionItems,
      ))
    }

    return sections
  }

  async addToFavorites(item: QueueItem | TopicItem | SubscriptionItem): Promise<void> {
    const favorites = this.context.globalState.get<IFavoriteItem[]>('peekabus.peek-a-bus.favorites', [])

    let favoriteItem: IFavoriteItem

    if (item instanceof QueueItem) {
      const id = `queue:${item.connectionString}:${item.label}`

      // Check if already exists
      if (favorites.some(f => f.id === id)) {
        vscode.window.showInformationMessage(`Queue '${item.label}' is already in favorites`)
        return
      }

      // Get service bus name from connection string
      const sbName = await this.getServiceBusName(item.connectionString)

      favoriteItem = {
        id,
        type: 'queue',
        serviceBusName: sbName,
        name: item.label,
      }
    }
    else if (item instanceof TopicItem) {
      const id = `topic:${item.connectionString}:${item.label}`

      // Check if already exists
      if (favorites.some(f => f.id === id)) {
        vscode.window.showInformationMessage(`Topic '${item.label}' is already in favorites`)
        return
      }

      // Get service bus name from connection string
      const sbName = await this.getServiceBusName(item.connectionString)

      favoriteItem = {
        id,
        type: 'topic',
        serviceBusName: sbName,
        name: item.label,
        topicName: item.label,
      }
    }
    else {
      const id = `subscription:${item.connectionString}:${item.topicName}:${item.label}`

      // Check if already exists
      if (favorites.some(f => f.id === id)) {
        vscode.window.showInformationMessage(`Subscription '${item.label}' is already in favorites`)
        return
      }

      // Get service bus name from connection string
      const sbName = await this.getServiceBusName(item.connectionString)

      favoriteItem = {
        id,
        type: 'subscription',
        serviceBusName: sbName,
        name: item.label,
        topicName: item.topicName,
      }
    }

    favorites.push(favoriteItem)
    await this.context.globalState.update('peekabus.peek-a-bus.favorites', favorites)
    console.log(`[Favorites] Added item:`, favoriteItem)
    console.log(`[Favorites] Total favorites:`, favorites.length)

    // Force refresh immediately
    this.refresh()

    // Show confirmation after refresh is triggered
    vscode.window.showInformationMessage(`Added '${favoriteItem.name}' to favorites`)
  }

  async removeFromFavorites(item: FavoriteTreeItem): Promise<void> {
    if (!item.favoriteItem) {
      return
    }

    const favorites = this.context.globalState.get<IFavoriteItem[]>('peekabus.peek-a-bus.favorites', [])
    const filtered = favorites.filter(f => f.id !== item.favoriteItem!.id)

    await this.context.globalState.update('peekabus.peek-a-bus.favorites', filtered)

    // Force refresh immediately
    this.refresh()

    // Show confirmation after refresh is triggered
    vscode.window.showInformationMessage(`Removed '${item.label}' from favorites`)
  }

  async openFavorite(favorite: IFavoriteItem): Promise<void> {
    try {
      // Get connection string from secrets
      const connectionString = await this.context.secrets.get(`peekabus.peek-a-bus.connection.${favorite.serviceBusName}`)

      if (!connectionString) {
        vscode.window.showErrorMessage(`Connection string not found for '${favorite.serviceBusName}'. Please reconnect.`)
        return
      }

      if (favorite.type === 'queue') {
        await ErrorHandler.withProgress(
          `Opening queue '${favorite.name}'...`,
          async () => {
            const queueProps = await service.getQueueRuntimeProperties(connectionString, favorite.name)
            const queueItem = new QueueItem(
              favorite.name,
              connectionString,
              queueProps.activeMessageCount,
              queueProps.deadLetterMessageCount,
            )
            await queueItem.show()
          },
        )
      }
      else if (favorite.type === 'topic') {
        vscode.window.showInformationMessage(`Topic '${favorite.name}' opened. Select a subscription to view messages.`)
        // Topics don't have messages directly, they need subscriptions
        // Could potentially expand the topic in the main view here
      }
      else if (favorite.type === 'subscription' && favorite.topicName) {
        await ErrorHandler.withProgress(
          `Opening subscription '${favorite.name}'...`,
          async () => {
            const subProps = await service.getSubscriptionRuntimeProperties(
              connectionString,
              favorite.topicName!,
              favorite.name,
            )
            const subItem = new SubscriptionItem(
              favorite.name,
              connectionString,
              subProps.activeMessageCount,
              subProps.deadLetterMessageCount,
              favorite.topicName!,
            )
            await subItem.show()
          },
        )
      }
    }
    catch (error) {
      ErrorHandler.handleError(error, `opening favorite '${favorite.name}'`)
    }
  }

  private async getServiceBusName(connectionString: string): Promise<string> {
    try {
      const sbInfo = await service.getServiceBusInfo(connectionString)
      return sbInfo.serviceBusName
    }
    catch {
      // Fallback: extract from connection string
      const match = connectionString.match(/Endpoint=sb:\/\/([^.]+)/)
      return match ? match[1] : 'Unknown'
    }
  }
}
