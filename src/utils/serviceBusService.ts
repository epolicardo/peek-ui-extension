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
    const queues = client.listQueuesRuntimeProperties().byPage() as AsyncIterableIterator<EntitiesResponse<QueueRuntimeProperties>>
    const topics = client.listTopicsRuntimeProperties().byPage() as AsyncIterableIterator<EntitiesResponse<TopicRuntimeProperties>>

    const queueResults: QueueRuntimeProperties[] = []
    const topicResults: TopicCustomProperties[] = []
    const topicRuntimeResults: TopicRuntimeProperties[] = []

    for await (const queue of queues) {
      queueResults.push(...queue)
    }

    for await (const topic of topics) {
      topicRuntimeResults.push(...topic)
    }

    for await (const topic of topicRuntimeResults) {
      const subscriptions = client
        .listSubscriptionsRuntimeProperties(topic.name)
        .byPage() as AsyncIterableIterator<EntitiesResponse<SubscriptionRuntimeProperties>>
      const subscriptionResults: SubscriptionRuntimeProperties[] = []
      for await (const subscription of subscriptions) {
        subscriptionResults.push(...subscription)
      }
      topicResults.push({
        properties: topic,
        subscriptions: subscriptionResults,
      })
    }

    return { connectionString, serviceBusName, queues: queueResults, topics: topicResults }
  } catch (error) {
    ErrorHandler.handleError(error, 'connecting to Service Bus')
    throw error
  }
}

export const getQueueRuntimeProperties = async (connectionString: string, queue: string): Promise<QueueRuntimeProperties> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    return await client.getQueueRuntimeProperties(queue)
  } catch (error) {
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
  } catch (error) {
    ErrorHandler.handleError(error, `getting properties for topic '${topic}'`)
    throw error
  }
}

export const getSubscriptionRuntimeProperties = async (connectionString: string, topic: string, subscription: string): Promise<SubscriptionRuntimeProperties> => {
  try {
    const client = ServiceBusClientManager.getAdminClient(connectionString)
    return await client.getSubscriptionRuntimeProperties(topic, subscription)
  } catch (error) {
    ErrorHandler.handleError(error, `getting properties for subscription '${subscription}'`)
    throw error
  }
}

export const peekQueueMessages = async (connectionString: string, queue: string, amount: number, dlAmount: number): Promise<ServiceBusMessageDetails> => {
  if (amount < 1 && dlAmount < 1) {
    return { messages: [], deadletter: [] }
  }
  // Service Bus supports up to 100 messages in peekMessages
  if (amount > 100) {
    amount = 100
  }
  if (dlAmount > 100) {
    dlAmount = 100
  }

  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const receiver = client.createReceiver(queue, { receiveMode: 'peekLock' })
    const messages = await peekMessages(receiver, amount)

    const dlReceiver = client.createReceiver(queue, { receiveMode: 'peekLock', subQueueType: 'deadLetter' })
    const deadletter = await peekMessages(dlReceiver, dlAmount)

    return { messages, deadletter }
  } catch (error) {
    ErrorHandler.handleError(error, `peeking messages from queue '${queue}'`)
    throw error
  }
}

export const peekSubscriptionMessages = async (connectionString: string, topic: string, subscription: string, amount: number, dlAmount: number): Promise<ServiceBusMessageDetails> => {
  if (amount < 1 && dlAmount < 1) {
    return { messages: [], deadletter: [] }
  }
  // Service Bus supports up to 100 messages in peekMessages
  if (amount > 100) {
    amount = 100
  }
  if (dlAmount > 100) {
    dlAmount = 100
  }

  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const receiver = client.createReceiver(topic, subscription, { receiveMode: 'peekLock' })
    const messages = await peekMessages(receiver, amount)

    const dlReceiver = client.createReceiver(topic, subscription, { receiveMode: 'peekLock', subQueueType: 'deadLetter' })
    const deadletter = await peekMessages(dlReceiver, dlAmount)

    return { messages, deadletter }
  } catch (error) {
    ErrorHandler.handleError(error, `peeking messages from subscription '${subscription}'`)
    throw error
  }
}

export const purgeQueueMessages = async (connectionString: string, queue: string): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const receiver = client.createReceiver(queue, { receiveMode: 'peekLock' })
    await completeMessages(receiver)
  } catch (error) {
    ErrorHandler.handleError(error, `purging messages from queue '${queue}'`)
    throw error
  }
}

export const purgeQueueDeadLetter = async (connectionString: string, queue: string): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const receiver = client.createReceiver(queue, { receiveMode: 'peekLock', subQueueType: 'deadLetter' })
    await completeMessages(receiver)
  } catch (error) {
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
  } catch (error) {
    ErrorHandler.handleError(error, `transferring deadletter messages from queue '${queue}'`)
    throw error
  }
}

export const purgeSubscriptionMessages = async (connectionString: string, topic: string, subscription: string): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const receiver = client.createReceiver(topic, subscription, { receiveMode: 'peekLock' })
    await completeMessages(receiver)
  } catch (error) {
    ErrorHandler.handleError(error, `purging messages from subscription '${subscription}'`)
    throw error
  }
}

export const purgeSubscriptionDeadletter = async (connectionString: string, topic: string, subscription: string): Promise<void> => {
  try {
    const client = ServiceBusClientManager.getClient(connectionString)
    const receiver = client.createReceiver(topic, subscription, { receiveMode: 'peekLock', subQueueType: 'deadLetter' })
    await completeMessages(receiver)
  } catch (error) {
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
  } catch (error) {
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

const peekMessages = async (receiver: ServiceBusReceiver, amount: number) => {
  try {
    return amount > 0 ? await receiver.peekMessages(amount) : []
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
  } catch (error) {
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
          vscode.commands.executeCommand('horgen.peek-ui.showMessages')
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
