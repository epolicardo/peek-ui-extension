import * as vscode from 'vscode'

/**
 * Centralized error handler for Service Bus operations.
 * Provides user-friendly error messages and logging.
 */
export class ErrorHandler {
  /**
     * Handles errors from Service Bus operations and shows appropriate messages to the user.
     */
  static handleError(error: unknown, operation: string): void {
    const errorMessage = this.getErrorMessage(error, operation)
    vscode.window.showErrorMessage(errorMessage)
    console.error(`[PeekUI] Error during ${operation}:`, error)
  }

  /**
     * Handles errors and returns a boolean indicating success/failure.
     * Useful for operations where you need to check the result.
     */
  static handleErrorWithResult(error: unknown, operation: string): false {
    this.handleError(error, operation)
    return false
  }

  /**
     * Gets a user-friendly error message based on the error type.
     */
  private static getErrorMessage(error: unknown, operation: string): string {
    if (error instanceof Error) {
      // Check for specific Service Bus error patterns
      if (error.message.includes('ENOTFOUND') || error.message.includes('ETIMEDOUT')) {
        return `Network error during ${operation}. Please check your connection and try again.`
      }

      if (error.message.includes('Unauthorized') || error.message.includes('401')) {
        return `Authentication failed during ${operation}. Please verify your connection string.`
      }

      if (error.message.includes('InvalidSignature') || error.message.includes('invalid signature')) {
        return `Invalid connection string signature during ${operation}. The SharedAccessKey may be incorrect, expired, or the connection string may be corrupted. Please verify your connection string.`
      }

      if (error.message.includes('404') || error.message.includes('does not exist')) {
        return `Resource not found during ${operation}. The queue, topic, or subscription may have been deleted.`
      }

      if (error.message.includes('429') || error.message.includes('Too many requests')) {
        return `Rate limit exceeded during ${operation}. Please wait a moment and try again.`
      }

      if (error.message.includes('403') || error.message.includes('Forbidden')) {
        return `Access denied during ${operation}. Please check your connection string permissions.`
      }

      // Return the actual error message if it's readable
      return `Error during ${operation}: ${error.message}`
    }

    return `Unknown error during ${operation}. Please check the console for details.`
  }

  /**
     * Validates a Service Bus connection string format.
     * Returns an error message if invalid, or null if valid.
     */
  static validateConnectionString(connectionString: string): string | null {
    if (!connectionString || connectionString.trim() === '') {
      return 'Connection string cannot be empty.'
    }

    // Check for Service Bus connection string format
    const hasEndpoint = connectionString.includes('Endpoint=sb://')
    const hasSharedAccessKey = connectionString.includes('SharedAccessKey=')

    if (!hasEndpoint) {
      return 'Invalid Service Bus connection string. Must start with "Endpoint=sb://..."'
    }

    if (!hasSharedAccessKey) {
      return 'Invalid Service Bus connection string. Must contain "SharedAccessKey".'
    }

    // Check if it's a Cosmos DB connection string (common mistake)
    if (connectionString.includes('AccountEndpoint=') || connectionString.includes('documents.azure.com')) {
      return 'This appears to be a Cosmos DB connection string. Please use a Service Bus connection string instead.'
    }

    return null
  }

  /**
     * Shows a progress notification while executing an async operation.
     */
  static async withProgress<T>(
    title: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false,
      },
      async () => {
        return await operation()
      },
    )
  }
}
