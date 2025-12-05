import * as vscode from 'vscode'
import { SbDependencyBase } from './SbDependencyBase'
import { ServiceBusProvider } from '../serviceBusProvider'

export class CategoryItem extends SbDependencyBase {
  constructor(
    public readonly categoryName: string,
    public readonly itemCount: number,
    public readonly iconName: string,
  ) {
    super(categoryName, '', vscode.TreeItemCollapsibleState.Collapsed)
    this.contextValue = 'category'
    this.iconPath = new vscode.ThemeIcon(iconName)
    this.description = `(${itemCount})`
  }

  async refresh(provider: ServiceBusProvider): Promise<void> {
    // Categories don't need refresh logic
    provider.refresh(this)
  }

  getDescription(): string {
    return `(${this.itemCount})`
  }

  update(item: SbDependencyBase): void {
    // Categories don't need update logic
  }
}
