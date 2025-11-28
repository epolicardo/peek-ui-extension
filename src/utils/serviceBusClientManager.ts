import { ServiceBusClient, ServiceBusAdministrationClient } from '@azure/service-bus'

/**
 * Singleton manager for ServiceBus clients to improve performance and resource management.
 * Reuses clients for the same connection string instead of creating new instances.
 */
export class ServiceBusClientManager {
    private static clients = new Map<string, ServiceBusClient>()
    private static adminClients = new Map<string, ServiceBusAdministrationClient>()

    /**
     * Gets or creates a ServiceBusClient for the given connection string.
     * Clients are cached and reused for better performance.
     */
    static getClient(connectionString: string): ServiceBusClient {
        if (!this.clients.has(connectionString)) {
            const client = new ServiceBusClient(connectionString)
            this.clients.set(connectionString, client)
        }
        return this.clients.get(connectionString)!
    }

    /**
     * Gets or creates a ServiceBusAdministrationClient for the given connection string.
     * Clients are cached and reused for better performance.
     */
    static getAdminClient(connectionString: string): ServiceBusAdministrationClient {
        if (!this.adminClients.has(connectionString)) {
            const client = new ServiceBusAdministrationClient(connectionString)
            this.adminClients.set(connectionString, client)
        }
        return this.adminClients.get(connectionString)!
    }

    /**
     * Closes and removes a client for the given connection string.
     * Useful when a connection is removed or needs to be reset.
     */
    static async closeClient(connectionString: string): Promise<void> {
        const client = this.clients.get(connectionString)
        if (client) {
            await client.close()
            this.clients.delete(connectionString)
        }
        this.adminClients.delete(connectionString)
    }

    /**
     * Closes all cached clients. Should be called on extension deactivation.
     */
    static async closeAllClients(): Promise<void> {
        const closePromises = Array.from(this.clients.values()).map(client => client.close())
        await Promise.all(closePromises)
        this.clients.clear()
        this.adminClients.clear()
    }

    /**
     * Gets the count of active clients (for debugging/monitoring).
     */
    static getClientCount(): number {
        return this.clients.size
    }
}
