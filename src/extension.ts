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

  vscode.window.registerTreeDataProvider('horgen.peek-ui', servicebusProvider)
  vscode.window.registerTreeDataProvider('horgen.peek-ui.favorites', favoritesProvider)
  vscode.commands.registerCommand('horgen.peek-ui.addConnection', () => {
    servicebusProvider.addConnection()
  })
  vscode.commands.registerCommand('horgen.peek-ui.connect', (node: ServiceBusItem) => {
    node.connect(servicebusProvider)
  })
  vscode.commands.registerCommand('horgen.peek-ui.refresh', (node: SbDependencyBase) => {
    node.refresh(servicebusProvider)
  })
  vscode.commands.registerCommand('horgen.peek-ui.showMessages', async (node: IInteractableItem) => {
    await node.show()
  })
  vscode.commands.registerCommand('horgen.peek-ui.transferDeadletterAll', async (node: IInteractableItem) => {
    await node.transfer(servicebusProvider)
  })
  vscode.commands.registerCommand('horgen.peek-ui.purgeMessages', async (node: IInteractableItem) => {
    await node.purge(servicebusProvider)
  })
  vscode.commands.registerCommand('horgen.peek-ui.purgeDeadletter', async (node: IInteractableItem) => {
    await node.purgeDl(servicebusProvider)
  })
  vscode.commands.registerCommand('horgen.peek-ui.removeConnection', async (node: ServiceBusItem) => {
    await servicebusProvider.removeConnection(node.label)
  })
  vscode.commands.registerCommand('horgen.peek-ui.editConnectionAlias', async (node: ServiceBusItem) => {
    await servicebusProvider.editConnectionAlias(node)
  })
  vscode.commands.registerCommand('horgen.peek-ui.addToFavorites', async (node: QueueItem | TopicItem | SubscriptionItem) => {
    await favoritesProvider.addToFavorites(node)
  })
  vscode.commands.registerCommand('horgen.peek-ui.removeFromFavorites', async (node: any) => {
    await favoritesProvider.removeFromFavorites(node)
  })
  vscode.commands.registerCommand('horgen.peek-ui.openFavorite', async (favorite: IFavoriteItem) => {
    await favoritesProvider.openFavorite(favorite)
  })
  vscode.commands.registerCommand('horgen.peek-ui.toggleMonitoring', async (node: QueueItem | SubscriptionItem) => {
    await node.toggleMonitoring(servicebusProvider)
  })
}

export async function deactivate() {
  // Stop all monitoring
  const serviceBusService = await import('./utils/serviceBusService.js')
  await serviceBusService.stopAllMonitoring()
  // Close all Service Bus client connections on extension deactivation
  await ServiceBusClientManager.closeAllClients()
}
