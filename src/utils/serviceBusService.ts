import type {
  EntitiesResponse,
  QueueRuntimeProperties,
  TopicRuntimeProperties,
  SubscriptionRuntimeProperties,
  ServiceBusReceiver,
  ServiceBusSender,
  ServiceBusReceivedMessage,
  ServiceBusMessage,
} from '@azure/service-bus'
import type { ServiceBusInfo, ServiceBusMessageDetails, TopicCustomProperties } from '../interfaces/ServiceBusInfo'

import { ServiceBusClientManager } from './serviceBusClientManager'
import { ErrorHandler } from './errorHandler'
import vscode from 'vscode'

// Message monitoring
interface ActiveMonitor {
  receiver: ServiceBusReceiver
  onMessageCallback: (message: ServiceBusReceivedMessage) => void
  connectionString: string
  entityPath: string
  type: 'queue' | 'subscription'
}

const activeMonitors = new Map<string, ActiveMonitor>()

export const getServiceBusInfo = async (connectionString: string): Promise<ServiceBusInfo> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)

    const nameSpace = await client.getNamespaceProperties()
    const serviceBusName = nameSpace.name

    // Load queues and topics in parallel
    const [queueResults, topicRuntimeResults] = await Promise.all([
      (async () => {
        const results: QueueRuntimeProperties[] = []
        const queues = client.listQueuesRuntimeProperties().byPage() as AsyncIterableIterator<EntitiesResponse<QueueRuntimeProperties>>
        for await (const queue of queues) {
          results.push(...queue)
        }
        return results
      })(),
      (async () => {
        const results: TopicRuntimeProperties[] = []
        const topics = client.listTopicsRuntimeProperties().byPage() as AsyncIterableIterator<EntitiesResponse<TopicRuntimeProperties>>
        for await (const topic of topics) {
          results.push(...topic)
        }
        return results
      })(),
    ])

    // Load all subscriptions in parallel for all topics
    const topicResults = await Promise.all(
      topicRuntimeResults.map(async (topic) => {
        const subscriptionResults: SubscriptionRuntimeProperties[] = []
        const subscriptions = client
          .listSubscriptionsRuntimeProperties(topic.name)
          .byPage() as AsyncIterableIterator<EntitiesResponse<SubscriptionRuntimeProperties>>

        for await (const subscription of subscriptions) {
          subscriptionResults.push(...subscription)
        }

        return {
          properties: topic,
          subscriptions: subscriptionResults,
        }
      }),
    )

    return { connectionString, serviceBusName, queues: queueResults, topics: topicResults }
  }
  catch (error) {
    ErrorHandler.handleError(error, 'connecting to Service Bus')
    throw error
  }
}

export const getQueueRuntimeProperties = async (connectionString: string, queue: string): Promise<QueueRuntimeProperties> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    return await client.getQueueRuntimeProperties(queue)
  }
  catch (error) {
    ErrorHandler.handleError(error, `getting properties for queue '${queue}'`)
    throw error
  }
}

export const getTopicCustomProperties = async (connectionString: string, topic: string): Promise<TopicCustomProperties> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    const topicRuntimeProperties = await client.getTopicRuntimeProperties(topic)
    const subscriptions = client
      .listSubscriptionsRuntimeProperties(topic)
      .byPage() as AsyncIterableIterator<EntitiesResponse<SubscriptionRuntimeProperties>>
    const subscriptionResults: SubscriptionRuntimeProperties[] = []
    for await (const subscription of subscriptions) {
      subscriptionResults.push(...subscription)
    }
    return { properties: topicRuntimeProperties, subscriptions: subscriptionResults }
  }
  catch (error) {
    ErrorHandler.handleError(error, `getting properties for topic '${topic}'`)
    throw error
  }
}

export const getSubscriptionRuntimeProperties = async (connectionString: string, topic: string, subscription: string): Promise<SubscriptionRuntimeProperties> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    return await client.getSubscriptionRuntimeProperties(topic, subscription)
  }
  catch (error) {
    ErrorHandler.handleError(error, `getting properties for subscription '${subscription}'`)
    throw error
  }
}

export const peekQueueMessages = async (connectionString: string, queue: string, amount: number, dlAmount: number, useReceiveMode = true): Promise<ServiceBusMessageDetails> => {
  if (amount < 1 && dlAmount < 1) {
    return { messages: [], deadletter: [] }
  }

  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const peekFn = useReceiveMode ? receiveAndAbandonMessages : peekMessagesWithPeekLock

    // Load active and deadletter messages in parallel for better performance
    const [messages, deadletter] = await Promise.all([
      amount > 0 ? peekFn(client.createReceiver(queue, { receiveMode: 'peekLock' }), amount) : Promise.resolve([]),
      dlAmount > 0 ? peekFn(client.createReceiver(queue, { receiveMode: 'peekLock', subQueueType: 'deadLetter' }), dlAmount) : Promise.resolve([]),
    ])

    return { messages, deadletter }
  }
  catch (error) {
    ErrorHandler.handleError(error, `peeking messages from queue '${queue}'`)
    throw error
  }
}

export const peekSubscriptionMessages = async (connectionString: string, topic: string, subscription: string, amount: number, dlAmount: number, useReceiveMode = true): Promise<ServiceBusMessageDetails> => {
  if (amount < 1 && dlAmount < 1) {
    return { messages: [], deadletter: [] }
  }

  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const peekFn = useReceiveMode ? receiveAndAbandonMessages : peekMessagesWithPeekLock
    console.log(`[peekSubscriptionMessages] Requesting ${amount} active and ${dlAmount} DL messages in parallel (mode: ${useReceiveMode ? 'receive' : 'peek'})`)

    // Load active and deadletter messages in parallel for better performance
    const [messages, deadletter] = await Promise.all([
      amount > 0 ? peekFn(client.createReceiver(topic, subscription, { receiveMode: 'peekLock' }), amount) : Promise.resolve([]),
      dlAmount > 0 ? peekFn(client.createReceiver(topic, subscription, { receiveMode: 'peekLock', subQueueType: 'deadLetter' }), dlAmount) : Promise.resolve([]),
    ])

    console.log(`[peekSubscriptionMessages] Received ${messages.length} active and ${deadletter.length} DL messages`)

    return { messages, deadletter }
  }
  catch (error) {
    ErrorHandler.handleError(error, `peeking messages from subscription '${subscription}'`)
    throw error
  }
}

export const purgeQueueMessages = async (connectionString: string, queue: string): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const receiver = client.createReceiver(queue, { receiveMode: 'peekLock' })
    await completeMessages(receiver)
  }
  catch (error) {
    ErrorHandler.handleError(error, `purging messages from queue '${queue}'`)
    throw error
  }
}

export const purgeQueueDeadLetter = async (connectionString: string, queue: string): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const receiver = client.createReceiver(queue, { receiveMode: 'peekLock', subQueueType: 'deadLetter' })
    await completeMessages(receiver)
  }
  catch (error) {
    ErrorHandler.handleError(error, `purging deadletter from queue '${queue}'`)
    throw error
  }
}

export const transferQueueDl = async (connectionString: string, queue: string): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const sender = client.createSender(queue)
    const dlReceiver = client.createReceiver(queue, { receiveMode: 'peekLock', subQueueType: 'deadLetter' })
    await transferMessages(dlReceiver, sender)
  }
  catch (error) {
    ErrorHandler.handleError(error, `transferring deadletter messages from queue '${queue}'`)
    throw error
  }
}

export const purgeSubscriptionMessages = async (connectionString: string, topic: string, subscription: string): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const receiver = client.createReceiver(topic, subscription, { receiveMode: 'peekLock' })
    await completeMessages(receiver)
  }
  catch (error) {
    ErrorHandler.handleError(error, `purging messages from subscription '${subscription}'`)
    throw error
  }
}

export const purgeSubscriptionDeadletter = async (connectionString: string, topic: string, subscription: string): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const receiver = client.createReceiver(topic, subscription, { receiveMode: 'peekLock', subQueueType: 'deadLetter' })
    await completeMessages(receiver)
  }
  catch (error) {
    ErrorHandler.handleError(error, `purging deadletter from subscription '${subscription}'`)
    throw error
  }
}

export const transferSubscriptionDl = async (connectionString: string, topic: string, subscription: string): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const sender = client.createSender(topic)
    const dlReceiver = client.createReceiver(topic, subscription, { receiveMode: 'peekLock', subQueueType: 'deadLetter' })
    await transferMessages(dlReceiver, sender)
  }
  catch (error) {
    ErrorHandler.handleError(error, `transferring deadletter messages from subscription '${subscription}'`)
    throw error
  }
}

const completeMessages = async (receiver: ServiceBusReceiver) => {
  try {
    let messages
    do {
      messages = await receiver.receiveMessages(10, { maxWaitTimeInMs: 150 })
      if (messages.length > 0) {
        for (const message of messages) {
          await receiver.completeMessage(message)
        }
      }
    } while (messages.length > 0)
  }
  finally {
    await receiver.close()
  }
}

// Peek mode: uses peekMessages() - reads from all partitions, no side effects (no deliveryCount increment)
// Note: peekMessages has a limit of ~256 messages per call, so we need to call it multiple times for larger amounts
const peekMessagesWithPeekLock = async (receiver: ServiceBusReceiver, amount: number) => {
  try {
    console.log(`[peekMessagesWithPeekLock] Called with amount: ${amount}`)
    if (amount <= 0) {
      console.log(`[peekMessagesWithPeekLock] Amount is 0 or negative, returning empty array`)
      return []
    }

    const allMessages: ServiceBusReceivedMessage[] = []
    const messageIds = new Set<string>()
    const iterations = 50 // Number of peek attempts to get messages from different partitions

    console.log(`[peekMessagesWithPeekLock] Launching ${iterations} parallel peek operations to collect unique messages`)

    // Launch multiple peek operations in parallel to increase chances of hitting different partitions
    const peekPromises = Array.from({ length: iterations }, (_, i) =>
      receiver.peekMessages(amount)
        .then((batch) => {
          console.log(`[peekMessagesWithPeekLock] Peek ${i + 1}/${iterations}: Received ${batch.length} messages`)
          return batch
        })
        .catch((err) => {
          console.error(`[peekMessagesWithPeekLock] Peek ${i + 1}/${iterations}: Error - ${err}`)
          return []
        }),
    )

    const batches = await Promise.all(peekPromises)

    // Deduplicate and collect all unique messages
    for (const [index, batch] of batches.entries()) {
      let newMessagesCount = 0
      for (const message of batch) {
        const msgId = message.messageId?.toString() || ''
        if (msgId && !messageIds.has(msgId)) {
          messageIds.add(msgId)
          allMessages.push(message)
          newMessagesCount++
        }
      }
      console.log(`[peekMessagesWithPeekLock] Batch ${index + 1}/${iterations}: Added ${newMessagesCount} unique messages (total: ${allMessages.length})`)
    }

    console.log(`[peekMessagesWithPeekLock] Completed ${iterations} parallel peeks. Returning ${allMessages.length} unique messages`)
    return allMessages
  }
  finally {
    await receiver.close()
  }
}

// Receive mode: uses receiveMessages() + abandonMessage() - reads ALL partitions, increments deliveryCount
const receiveAndAbandonMessages = async (receiver: ServiceBusReceiver, amount: number) => {
  try {
    console.log(`[receiveAndAbandonMessages] Called with amount: ${amount}`)
    if (amount <= 0) {
      console.log(`[receiveAndAbandonMessages] Amount is 0 or negative, returning empty array`)
      return []
    }

    // Use receiveMessages() + abandonMessage() to read messages from ALL partitions
    // This increments deliveryCount but is the ONLY way to see all messages in partitioned entities
    const allMessages: ServiceBusReceivedMessage[] = []
    const messageIds = new Set<string>()
    let batchCount = 0
    const maxBatches = Math.ceil(amount / 10) + 5 // Add buffer for duplicates

    console.log(`[receiveAndAbandonMessages] Starting receive loop, max ${maxBatches} batches`)

    while (allMessages.length < amount && batchCount < maxBatches) {
      const batch = await receiver.receiveMessages(10, { maxWaitTimeInMs: 2000 })
      batchCount++
      console.log(`[receiveAndAbandonMessages] Batch ${batchCount}: received ${batch.length} messages`)

      if (batch.length === 0) {
        console.log(`[receiveAndAbandonMessages] Empty batch, stopping`)
        break
      }

      // Process messages and abandon in parallel
      const abandonPromises: Promise<void>[] = []

      for (const message of batch) {
        // Deduplicate by messageId (convert to string for Set)
        const msgId = message.messageId?.toString() || ''
        if (msgId && !messageIds.has(msgId)) {
          messageIds.add(msgId)
          allMessages.push(message)
        }

        // Abandon all messages in parallel (fire and forget)
        abandonPromises.push(receiver.abandonMessage(message))
      }

      // Wait for all abandon operations to complete before next batch
      await Promise.all(abandonPromises)

      console.log(`[receiveAndAbandonMessages] Total unique messages so far: ${allMessages.length}`)
    }

    console.log(`[receiveAndAbandonMessages] Completed. Returning ${allMessages.length} messages after ${batchCount} batches`)
    return allMessages
  }
  finally {
    await receiver.close()
  }
}

const receiveAllMessages = async (receiver: ServiceBusReceiver) => {
  let messages
  let receivedMessages: ServiceBusReceivedMessage[] = []
  do {
    messages = await receiver.receiveMessages(10, { maxWaitTimeInMs: 150 })
    if (messages.length > 0) {
      receivedMessages = receivedMessages.concat(messages)
    }
  } while (messages.length > 0)
  return receivedMessages
}

const transferMessages = async (receiver: ServiceBusReceiver, sender: ServiceBusSender, amount?: number) => {
  try {
    const receivedMessages = await receiveAllMessages(receiver)
    while (receivedMessages.length > 0) {
      const messages = receivedMessages.splice(0, 10)
      const messagesToSend = messages.map(createMessageFromDeadletter)
      await sender.sendMessages(messagesToSend)
      for (const message of messages) {
        await receiver.completeMessage(message)
      }
    }
  }
  finally {
    await receiver.close()
    await sender.close()
  }
}

export const sendMessage = async (connectionString: string, destination: string, message: ServiceBusMessage): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const sender = client.createSender(destination)
    try {
      await sender.sendMessages(message)
    }
    finally {
      await sender.close()
    }
  }
  catch (error) {
    ErrorHandler.handleError(error, `sending message to '${destination}'`)
    throw error
  }
}

export const startMonitoring = async (
  connectionString: string,
  entityPath: string,
  type: 'queue' | 'subscription',
  topicName?: string,
  onMessage?: (message: ServiceBusReceivedMessage) => void,
): Promise<void> => {
  try {
    const monitorKey = `${connectionString}:${entityPath}`

    // If already monitoring, stop first
    if (activeMonitors.has(monitorKey)) {
      await stopMonitoring(connectionString, entityPath)
    }

    const adminClient = ServiceBusClientManager.getAdminClient(connectionString)
    const client = ServiceBusClientManager.getClient(connectionString)
    let receiver: ServiceBusReceiver
    let requiresSession = false

    // Check if entity requires sessions
    if (type === 'queue') {
      const queueProps = await adminClient.getQueue(entityPath)
      requiresSession = queueProps.requiresSession || false
    }
    else {
      if (!topicName) {
        throw new Error('Topic name is required for subscription monitoring')
      }
      const subscriptionProps = await adminClient.getSubscription(topicName, entityPath)
      requiresSession = subscriptionProps.requiresSession || false
    }

    // Create appropriate receiver based on session requirement
    if (requiresSession) {
      vscode.window.showWarningMessage(
        `${type === 'queue' ? 'Queue' : 'Subscription'} '${entityPath}' requires sessions. Session-based monitoring is not supported yet.`,
      )
      return
    }

    if (type === 'queue') {
      receiver = client.createReceiver(entityPath, { receiveMode: 'peekLock' })
    }
    else {
      receiver = client.createReceiver(topicName!, entityPath, { receiveMode: 'peekLock' })
    }

    const messageHandler = async (message: ServiceBusReceivedMessage) => {
      // Show notification
      const entityDisplay = type === 'queue' ? `Queue: ${entityPath}` : `Topic: ${topicName} → Subscription: ${entityPath}`
      vscode.window.showInformationMessage(
        `📬 New message in ${entityDisplay}`,
        'View Messages',
      ).then((selection) => {
        if (selection === 'View Messages') {
          vscode.commands.executeCommand('peekabus.peek-a-bus.showMessages')
        }
      })

      // Call custom callback if provided
      if (onMessage) {
        onMessage(message)
      }

      // Abandon message so it stays in the queue/subscription
      try {
        await receiver.abandonMessage(message)
      }
      catch (error) {
        console.error('Error abandoning message:', error)
      }
    }

    const errorHandler = async (args: { error: Error }) => {
      console.error(`Error monitoring ${entityPath}:`, args.error)
      vscode.window.showErrorMessage(`Monitoring error on ${entityPath}: ${args.error.message}`)
      // Try to restart monitoring
      await stopMonitoring(connectionString, entityPath)
    }

    // Subscribe to messages
    receiver.subscribe({
      processMessage: messageHandler,
      processError: errorHandler,
    })

    activeMonitors.set(monitorKey, {
      receiver,
      onMessageCallback: messageHandler,
      connectionString,
      entityPath,
      type,
    })

    const displayName = type === 'queue' ? entityPath : `${topicName}/${entityPath}`
    vscode.window.showInformationMessage(`🔔 Monitoring started for ${type}: ${displayName}`)
  }
  catch (error) {
    ErrorHandler.handleError(error, `starting monitoring for ${entityPath}`)
    throw error
  }
}

export const stopMonitoring = async (connectionString: string, entityPath: string): Promise<void> => {
  try {
    const monitorKey = `${connectionString}:${entityPath}`
    const monitor = activeMonitors.get(monitorKey)

    if (monitor) {
      await monitor.receiver.close()
      activeMonitors.delete(monitorKey)
      vscode.window.showInformationMessage(`🔕 Monitoring stopped for ${monitor.type}: ${entityPath}`)
    }
  }
  catch (error) {
    ErrorHandler.handleError(error, `stopping monitoring for ${entityPath}`)
    throw error
  }
}

export const isMonitoring = (connectionString: string, entityPath: string): boolean => {
  const monitorKey = `${connectionString}:${entityPath}`
  return activeMonitors.has(monitorKey)
}

export const stopAllMonitoring = async (): Promise<void> => {
  const monitors = Array.from(activeMonitors.values())
  await Promise.all(monitors.map(m => m.receiver.close()))
  activeMonitors.clear()
  vscode.window.showInformationMessage('🔕 All monitoring stopped')
}

// Subscription Management
export const createSubscription = async (
  connectionString: string,
  topicName: string,
  subscriptionName: string,
  options?: {
    maxDeliveryCount?: number
    lockDuration?: string
    defaultMessageTimeToLive?: string
    requiresSession?: boolean
    deadLetteringOnMessageExpiration?: boolean
  },
): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    await client.createSubscription(topicName, subscriptionName, options)
    vscode.window.showInformationMessage(`Subscription '${subscriptionName}' created successfully`)
  }
  catch (error) {
    ErrorHandler.handleError(error, `creating subscription '${subscriptionName}'`)
    throw error
  }
}

export const deleteSubscription = async (
  connectionString: string,
  topicName: string,
  subscriptionName: string,
): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    await client.deleteSubscription(topicName, subscriptionName)
    vscode.window.showInformationMessage(`Subscription '${subscriptionName}' deleted successfully`)
  }
  catch (error) {
    ErrorHandler.handleError(error, `deleting subscription '${subscriptionName}'`)
    throw error
  }
}

export const updateSubscription = async (
  connectionString: string,
  topicName: string,
  subscriptionName: string,
  options: {
    maxDeliveryCount?: number
    lockDuration?: string
    defaultMessageTimeToLive?: string
    deadLetteringOnMessageExpiration?: boolean
  },
): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    const subscription = await client.getSubscription(topicName, subscriptionName)

    // Update properties
    if (options.maxDeliveryCount !== undefined) {
      subscription.maxDeliveryCount = options.maxDeliveryCount
    }
    if (options.lockDuration !== undefined) {
      subscription.lockDuration = options.lockDuration
    }
    if (options.defaultMessageTimeToLive !== undefined) {
      subscription.defaultMessageTimeToLive = options.defaultMessageTimeToLive
    }
    if (options.deadLetteringOnMessageExpiration !== undefined) {
      subscription.deadLetteringOnMessageExpiration = options.deadLetteringOnMessageExpiration
    }

    await client.updateSubscription(subscription)
    vscode.window.showInformationMessage(`Subscription '${subscriptionName}' updated successfully`)
  }
  catch (error) {
    ErrorHandler.handleError(error, `updating subscription '${subscriptionName}'`)
    throw error
  }
}

// Subscription Rules Management
export const createSubscriptionRule = async (
  connectionString: string,
  topicName: string,
  subscriptionName: string,
  ruleName: string,
  sqlFilter: string,
): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    await client.createRule(topicName, subscriptionName, ruleName, { sqlExpression: sqlFilter })
    vscode.window.showInformationMessage(`Rule '${ruleName}' created successfully`)
  }
  catch (error) {
    ErrorHandler.handleError(error, `creating rule '${ruleName}'`)
    throw error
  }
}

export const deleteSubscriptionRule = async (
  connectionString: string,
  topicName: string,
  subscriptionName: string,
  ruleName: string,
): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    await client.deleteRule(topicName, subscriptionName, ruleName)
    vscode.window.showInformationMessage(`Rule '${ruleName}' deleted successfully`)
  }
  catch (error) {
    ErrorHandler.handleError(error, `deleting rule '${ruleName}'`)
    throw error
  }
}

export const listSubscriptionRules = async (
  connectionString: string,
  topicName: string,
  subscriptionName: string,
): Promise<Array<{ name: string, filter: any, action?: any }>> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    const rules = []

    for await (const rule of client.listRules(topicName, subscriptionName)) {
      rules.push({
        name: rule.name,
        filter: rule.filter,
        action: rule.action,
      })
    }

    return rules
  }
  catch (error) {
    ErrorHandler.handleError(error, `listing rules for subscription '${subscriptionName}'`)
    throw error
  }
}

const createMessageFromDeadletter = (message: ServiceBusReceivedMessage): ServiceBusMessage => {
  return {
    body: message.body,
    contentType: message.contentType,
    correlationId: message.correlationId,
    subject: message.subject,
    messageId: message.messageId,
    partitionKey: message.partitionKey,
    replyTo: message.replyTo,
    replyToSessionId: message.replyToSessionId,
    sessionId: message.sessionId,
    timeToLive: message.timeToLive,
    applicationProperties: message.applicationProperties,
  }
}
