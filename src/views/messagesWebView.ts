import vscode from 'vscode'
import { ServiceBusMessageDetails } from '../interfaces/ServiceBusInfo'
import { ServiceBusReceivedMessage } from '@azure/service-bus'
import { SbDependencyBase } from '../models/SbDependencyBase'

export class MessagesWebView {
  public panel: vscode.WebviewPanel | undefined

  constructor(private dependency: SbDependencyBase, private messagesDetails: ServiceBusMessageDetails) { }

  public reveal() {
    if (this.panel?.visible === false) {
      this.panel.reveal()
    }
  }

  public update(messagesDetails: ServiceBusMessageDetails) {
    if (this.panel?.visible) {
      this.messagesDetails = messagesDetails
      this.panel.webview.html = this.getWebviewContent()
    }
  }

  public show() {
    this.panel = vscode.window.createWebviewPanel(
      'messages',
      `${this.dependency.label}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
      },
    )

    this.panel.webview.html = this.getWebviewContent()

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'resendMessage') {
          await this.handleResendMessage(message.messageIndex, message.isDeadletter)
        }
      },
    )
  }

  private async handleResendMessage(messageIndex: number, isDeadletter: boolean): Promise<void> {
    const messages = isDeadletter ? this.messagesDetails.deadletter : this.messagesDetails.messages
    const message = messages[messageIndex]

    if (!message) {
      vscode.window.showErrorMessage('Message not found')
      return
    }

    // Get topic name if available (for subscriptions)
    const topicName = (this.dependency as any).topicName

    // Ask for destination
    const destination = await vscode.window.showInputBox({
      prompt: 'Enter destination queue or topic name',
      placeHolder: 'e.g., my-queue or my-topic',
      value: topicName || '',
      ignoreFocusOut: true,
    })

    if (!destination) {
      return
    }

    try {
      const { sendMessage } = await import('../utils/serviceBusService.js')
      const { ErrorHandler } = await import('../utils/errorHandler.js')

      // Get connection string from dependency
      const connectionString = (this.dependency as any).connectionString

      if (!connectionString) {
        vscode.window.showErrorMessage('Connection string not found')
        return
      }

      await ErrorHandler.withProgress(
        `Resending message to '${destination}'...`,
        async () => {
          await sendMessage(connectionString, destination, {
            body: message.body,
            contentType: message.contentType,
            correlationId: message.correlationId,
            subject: message.subject,
            messageId: message.messageId,
            partitionKey: message.partitionKey,
            sessionId: message.sessionId,
            replyTo: message.replyTo,
            replyToSessionId: message.replyToSessionId,
            timeToLive: message.timeToLive,
            applicationProperties: message.applicationProperties,
          })
        },
      )

      vscode.window.showInformationMessage(`Message resent successfully to '${destination}'`)
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to resend message: ${error}`)
    }
  }

  private getWebviewContent(): string {
    const messagesHtml = this.createMessageList(this.messagesDetails.messages)
    const deadLetterHtml = this.createMessageList(this.messagesDetails.deadletter)

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Messages</title>
          <style>
              * {
                box-sizing: border-box;
              }
              body {
                color: var(--vscode-editor-foreground);
                background-color: var(--vscode-editor-background);
                font-family: var(--vscode-font-family);
                font-weight: var(--vscode-font-weight);
                font-size: var(--vscode-font-size);
                padding: 0;
                margin: 0;
              }
              .tabs {
                display: flex;
                flex-direction: column;
                width: 100%;
                height: 100%;
              }
              .labelgroup {
                display: flex;
                border-bottom: 1px solid var(--vscode-tab-border);
                margin-bottom: 16px;
              }
              .label {
                padding: 10px 30px;
                cursor: pointer;
                font-weight: bold;
                font-size: 14px;
                transition: background 0.1s, color 0.1s;
                background: var(--vscode-tab-inactiveBackground);
                color: var(--vscode-tab-inactiveForeground);
                border: none;
                border-bottom: 2px solid transparent;
              }
              .label:hover {
                background: var(--vscode-tab-hoverBackground);
                color: var(--vscode-tab-hoverForeground);
              }
              .label.active {
                background: var(--vscode-tab-activeBackground);
                color: var(--vscode-tab-activeForeground);
                border-bottom: 2px solid var(--vscode-tab-activeBorder);
              }
              .panel {
                width: 100%;
                display: none;
                padding: 0 16px 16px 16px;
              }
              .panel.active {
                display: block;
              }
              .message-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
              }
              .message-card {
                border: 1px solid var(--vscode-panel-border);
                background: var(--vscode-editor-background);
                border-radius: 4px;
              }
              .message-header {
                padding: 12px 16px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: var(--vscode-sideBar-background);
                user-select: none;
                border-radius: 4px 4px 0 0;
              }
              .message-header:hover {
                background: var(--vscode-list-hoverBackground);
              }
              .message-header-left {
                display: flex;
                align-items: center;
                gap: 12px;
                flex: 1;
                min-width: 0;
              }
              .message-timestamp {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                white-space: nowrap;
              }
              .message-id {
                font-weight: bold;
                color: var(--vscode-textLink-foreground);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
              .message-badge {
                padding: 2px 8px;
                border-radius: 3px;
                font-size: 11px;
                font-weight: bold;
                background: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
              }
              .expand-icon {
                font-size: 16px;
                transition: transform 0.2s;
                color: var(--vscode-icon-foreground);
              }
              .expand-icon.expanded {
                transform: rotate(90deg);
              }
              .message-body {
                display: none;
                padding: 16px;
                border-top: 1px solid var(--vscode-panel-border);
              }
              .message-body.expanded {
                display: block;
              }
              .section {
                margin-bottom: 16px;
              }
              .section:last-child {
                margin-bottom: 0;
              }
              .section-title {
                font-weight: bold;
                margin-bottom: 8px;
                color: var(--vscode-textPreformat-foreground);
                font-size: 13px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
              }
              .code-block {
                background: var(--vscode-textCodeBlock-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                padding: 12px;
                overflow-x: auto;
                font-family: var(--vscode-editor-font-family);
                font-size: 13px;
                line-height: 1.5;
                white-space: pre-wrap;
                word-break: break-all;
              }
              /* JSON syntax highlighting */
              .json-key {
                color: var(--vscode-symbolIcon-variableForeground);
              }
              .json-string {
                color: var(--vscode-debugTokenExpression-string);
              }
              .json-number {
                color: var(--vscode-debugTokenExpression-number);
              }
              .json-boolean {
                color: var(--vscode-debugTokenExpression-boolean);
              }
              .json-null {
                color: var(--vscode-debugTokenExpression-name);
              }
              .json-punctuation {
                color: var(--vscode-editor-foreground);
              }
              .properties-grid {
                display: grid;
                grid-template-columns: auto 1fr;
                gap: 8px 16px;
                font-size: 13px;
              }
              .property-key {
                font-weight: bold;
                color: var(--vscode-symbolIcon-variableForeground);
              }
              .property-value {
                color: var(--vscode-editor-foreground);
                word-break: break-word;
              }
              .empty-message {
                text-align: center;
                padding: 40px;
                color: var(--vscode-descriptionForeground);
                font-style: italic;
              }
              .filter-container {
                margin-bottom: 16px;
                position: sticky;
                top: 0;
                background: var(--vscode-editor-background);
                z-index: 10;
                padding: 8px 0;
              }
              .filter-input {
                width: 100%;
                padding: 8px 12px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                font-family: var(--vscode-font-family);
                font-size: 13px;
              }
              .filter-input:focus {
                outline: 1px solid var(--vscode-focusBorder);
                border-color: var(--vscode-focusBorder);
              }
              .filter-input::placeholder {
                color: var(--vscode-input-placeholderForeground);
              }
              .message-card.hidden {
                display: none;
              }
              .message-actions {
                display: flex;
                gap: 8px;
                align-items: center;
              }
              .resend-button {
                padding: 4px 12px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 3px;
                cursor: pointer;
                font-size: 11px;
                font-weight: bold;
                transition: background 0.1s;
              }
              .resend-button:hover {
                background: var(--vscode-button-hoverBackground);
              }
              .resend-button:active {
                background: var(--vscode-button-secondaryBackground);
              }
          </style>
      </head>
      <body>
          <div class="tabs">
            <div class="labelgroup">
              <button class="label active" id="tab-1" onclick="openTab('tab-1', 'messages-panel')">
                Messages (${this.messagesDetails.messages.length})
              </button>
              <button class="label" id="tab-2" onclick="openTab('tab-2', 'deadletter-panel')">
                Deadletter (${this.messagesDetails.deadletter.length})
              </button>
            </div>
            
            <div class="panel active" id="messages-panel">
              <div class="filter-container">
                <input type="text" class="filter-input" id="filter-messages" 
                       placeholder="Filter messages by ID, body, or properties..." 
                       oninput="filterMessages('messages-panel')" />
              </div>
              ${messagesHtml}
            </div>

            <div class="panel" id="deadletter-panel">
              <div class="filter-container">
                <input type="text" class="filter-input" id="filter-deadletter" 
                       placeholder="Filter messages by ID, body, or properties..." 
                       oninput="filterMessages('deadletter-panel')" />
              </div>
              ${deadLetterHtml}
            </div>
          </div>

          <script>
              function openTab(btn, tabName) {
                  const panels = document.getElementsByClassName("panel");
                  for (let i = 0; i < panels.length; i++) {
                      panels[i].classList.remove("active");
                  }

                  const tabButtons = document.getElementsByClassName("label");
                  for (let i = 0; i < tabButtons.length; i++) {
                      tabButtons[i].classList.remove("active");
                  }
                  
                  document.getElementById(tabName).classList.add("active");
                  document.getElementById(btn).classList.add("active");
              }

              function toggleMessage(id) {
                  const body = document.getElementById('body-' + id);
                  const icon = document.getElementById('icon-' + id);
                  
                  if (body.classList.contains('expanded')) {
                      body.classList.remove('expanded');
                      icon.classList.remove('expanded');
                  } else {
                      body.classList.add('expanded');
                      icon.classList.add('expanded');
                  }
              }

              function formatJson(value) {
                  try {
                      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
                      return JSON.stringify(parsed, null, 2);
                  } catch {
                      return typeof value === 'object' ? JSON.stringify(value, null, 2) : value;
                  }
              }

              function filterMessages(panelId) {
                  const panel = document.getElementById(panelId);
                  const filterInput = panel.querySelector('.filter-input');
                  const filterText = filterInput.value.toLowerCase();
                  const messageCards = panel.querySelectorAll('.message-card');
                  
                  messageCards.forEach(card => {
                      const text = card.textContent.toLowerCase();
                      if (text.includes(filterText)) {
                          card.classList.remove('hidden');
                      } else {
                          card.classList.add('hidden');
                      }
                  });
              }

              function resendMessage(messageIndex, isDeadletter) {
                  const vscode = acquireVsCodeApi();
                  vscode.postMessage({
                      command: 'resendMessage',
                      messageIndex: messageIndex,
                      isDeadletter: isDeadletter
                  });
              }
          </script>
      </body>
      </html>
    `
  }

  private createMessageList(messages: ServiceBusReceivedMessage[]): string {
    if (messages.length === 0) {
      return '<div class="empty-message">No messages found</div>'
    }

    const messageCards = messages.map((m, index) => {
      const bodyContent = this.formatBody(m.body)
      const hasCustomProperties = m.applicationProperties && Object.keys(m.applicationProperties).length > 0

      return `
        <div class="message-card">
          <div class="message-header" onclick="toggleMessage(${index})">
            <div class="message-header-left">
              <span class="expand-icon" id="icon-${index}">▶</span>
              <span class="message-id">${this.escapeHtml((m.messageId || 'No ID').toString())}</span>
              ${m.enqueuedTimeUtc ? `<span class="message-timestamp">${this.formatTimestamp(m.enqueuedTimeUtc)}</span>` : ''}
              ${(m.deliveryCount ?? 0) > 0 ? `<span class="message-badge">Delivery: ${m.deliveryCount}</span>` : ''}
            </div>
            <div class="message-actions">
              <button class="resend-button" onclick="event.stopPropagation(); resendMessage(${index}, ${this.messagesDetails.deadletter.includes(m)})">
                📤 Resend
              </button>
            </div>
          </div>
          <div class="message-body" id="body-${index}">
            <div class="section">
              <div class="section-title">Message Body</div>
              <div class="code-block">${bodyContent}</div>
            </div>

            <div class="section">
              <div class="section-title">Properties</div>
              <div class="properties-grid">
                ${this.renderProperty('Message ID', m.messageId)}
                ${this.renderProperty('Correlation ID', m.correlationId)}
                ${this.renderProperty('Session ID', m.sessionId)}
                ${this.renderProperty('Content Type', m.contentType)}
                ${this.renderProperty('Subject', m.subject)}
                ${this.renderProperty('Reply To', m.replyTo)}
                ${this.renderProperty('Reply To Session ID', m.replyToSessionId)}
                ${this.renderProperty('Partition Key', m.partitionKey)}
                ${this.renderProperty('Enqueued Time', m.enqueuedTimeUtc?.toISOString())}
                ${this.renderProperty('Scheduled Time', m.scheduledEnqueueTimeUtc?.toISOString())}
                ${this.renderProperty('Time To Live', m.timeToLive ? `${m.timeToLive}ms` : undefined)}
                ${this.renderProperty('Delivery Count', m.deliveryCount)}
                ${this.renderProperty('Sequence Number', m.sequenceNumber?.toString())}
                ${this.renderProperty('Lock Token', m.lockToken)}
              </div>
            </div>

            ${hasCustomProperties ? `
            <div class="section">
              <div class="section-title">Custom Properties</div>
              <div class="code-block">${this.formatJson(m.applicationProperties)}</div>
            </div>
            ` : ''}

            ${m.deadLetterReason || m.deadLetterErrorDescription ? `
            <div class="section">
              <div class="section-title">Dead Letter Information</div>
              <div class="properties-grid">
                ${this.renderProperty('Reason', m.deadLetterReason)}
                ${this.renderProperty('Description', m.deadLetterErrorDescription)}
                ${this.renderProperty('Dead Letter Source', m.deadLetterSource)}
              </div>
            </div>
            ` : ''}
          </div>
        </div>
      `
    }).join('')

    return `<div class="message-list">${messageCards}</div>`
  }

  private formatBody(body: unknown): string {
    if (body === null || body === undefined) {
      return '<em>Empty</em>'
    }

    if (typeof body === 'string') {
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(body)
        return this.syntaxHighlightJson(parsed)
      } catch {
        return this.escapeHtml(body)
      }
    }

    if (typeof body === 'object') {
      return this.syntaxHighlightJson(body)
    }

    return this.escapeHtml(String(body))
  }

  private formatJson(obj: unknown): string {
    try {
      return this.syntaxHighlightJson(obj)
    } catch {
      return this.escapeHtml(String(obj))
    }
  }

  private syntaxHighlightJson(obj: unknown): string {
    let json = JSON.stringify(obj, null, 2)

    // Escape HTML first
    json = json.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    // Apply syntax highlighting
    json = json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?)/g, (match) => {
      let cls = 'json-string'
      if (/:$/.test(match)) {
        // It's a key
        cls = 'json-key'
        return `<span class="${cls}">${match}</span>`
      }
      return `<span class="${cls}">${match}</span>`
    })

    // Numbers
    json = json.replace(/\b(-?\d+\.?\d*)\b(?!["<])/g, '<span class="json-number">$1</span>')

    // Booleans
    json = json.replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')

    // Null
    json = json.replace(/\b(null)\b/g, '<span class="json-null">$1</span>')

    return json
  }

  private renderProperty(key: string, value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return ''
    }
    return `
      <div class="property-key">${this.escapeHtml(key)}:</div>
      <div class="property-value">${this.escapeHtml(String(value))}</div>
    `
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }
    return text.replace(/[&<>"']/g, (m) => map[m])
  }
}
