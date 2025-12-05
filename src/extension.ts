import * as vscode from 'vscode'
import { ServiceBusProvider } from './serviceBusProvider'
import { FavoritesProvider } from './favoritesProvider'
import { IInteractableItem } from './interfaces/IInteractableItem'
import { SbDependencyBase } from './models/SbDependencyBase'
import { ServiceBusItem } from './models/ServiceBusItem'
import { QueueItem } from './models/QueueItem'
import { TopicItem } from './models/TopicItem'
import { SubscriptionItem } from './models/SubscriptionItem'
import { ServiceBusClientManager } from './utils/serviceBusClientManager'
import { IFavoriteItem } from './interfaces/IFavoriteItem'

export function activate(context: vscode.ExtensionContext) {
  const servicebusProvider = new ServiceBusProvider(context)
  const favoritesProvider = new FavoritesProvider(context)

  vscode.window.registerTreeDataProvider('peekabus.peek-a-bus', servicebusProvider)
  vscode.window.registerTreeDataProvider('peekabus.peek-a-bus.favorites', favoritesProvider)
  vscode.commands.registerCommand('peekabus.peek-a-bus.addConnection', () => {
    servicebusProvider.addConnection()
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.connect', (node: ServiceBusItem) => {
    node.connect(servicebusProvider)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.refresh', (node: SbDependencyBase) => {
    node.refresh(servicebusProvider)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.showMessages', async (node: IInteractableItem) => {
    await node.show()
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.transferDeadletterAll', async (node: IInteractableItem) => {
    await node.transfer(servicebusProvider)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.purgeMessages', async (node: IInteractableItem) => {
    await node.purge(servicebusProvider)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.purgeDeadletter', async (node: IInteractableItem) => {
    await node.purgeDl(servicebusProvider)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.removeConnection', async (node: ServiceBusItem) => {
    await servicebusProvider.removeConnection(node.label)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.editConnectionAlias', async (node: ServiceBusItem) => {
    await servicebusProvider.editConnectionAlias(node)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.addToFavorites', async (node: QueueItem | TopicItem | SubscriptionItem) => {
    await favoritesProvider.addToFavorites(node)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.removeFromFavorites', async (node: any) => {
    await favoritesProvider.removeFromFavorites(node)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.openFavorite', async (favorite: IFavoriteItem) => {
    await favoritesProvider.openFavorite(favorite)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.toggleMonitoring', async (node: QueueItem | SubscriptionItem) => {
    await node.toggleMonitoring(servicebusProvider)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.exportConnections', async () => {
    await servicebusProvider.exportConnections()
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.importConnections', async () => {
    await servicebusProvider.importConnections()
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.createSubscription', async (node: TopicItem) => {
    await node.createSubscription(servicebusProvider)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.editSubscription', async (node: SubscriptionItem) => {
    await node.editSubscription(servicebusProvider)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.deleteSubscription', async (node: SubscriptionItem) => {
    await node.deleteSubscription(servicebusProvider)
  })
  vscode.commands.registerCommand('peekabus.peek-a-bus.manageRules', async (node: SubscriptionItem) => {
    await node.manageRules()
  })
}

export async function deactivate() {
  // Stop all monitoring
  const serviceBusService = await import('./utils/serviceBusService.js')
  await serviceBusService.stopAllMonitoring()
  // Close all Service Bus client connections on extension deactivation
  await ServiceBusClientManager.closeAllClients()
}
