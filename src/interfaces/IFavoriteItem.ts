export interface IFavoriteItem {
    id: string
    type: 'queue' | 'topic' | 'subscription'
    serviceBusName: string
    name: string
    topicName?: string // For subscriptions (parent topic) or for topics themselves
    connectionString?: string // Stored temporarily, retrieved from secrets
}
