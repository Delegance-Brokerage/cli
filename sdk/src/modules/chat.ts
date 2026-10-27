/**
 * Chat Module
 * 
 * Handles chat/LLM interactions with the Orin insurance assistant.
 */

import { HttpClient } from '../utils/http';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  /** Conversation ID for maintaining context across messages */
  conversationId?: string;
  
  /** Optional context to focus the response */
  context?: {
    policyId?: string;
    documentId?: string;
  };
}

export interface ChatResponse {
  success: boolean;
  response: string;
  conversationId: string;
  intent?: string;
  sources?: Array<{
    fileName: string;
    excerpt: string;
  }>;
  traceId: string;
}

export class ChatModule {
  constructor(private http: HttpClient) {}

  /**
   * Send a message to the Orin insurance assistant
   * 
   * @example
   * ```typescript
   * const response = await client.chat.ask('What is my GL coverage limit?');
   * console.log(response.response);
   * 
   * // Continue the conversation
   * const followUp = await client.chat.ask('And when does it expire?', {
   *   conversationId: response.conversationId
   * });
   * ```
   */
  async ask(message: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const response = await this.http.request<ChatResponse>({
      method: 'POST',
      path: '/api/v1/chat',
      body: {
        message,
        conversationId: options.conversationId,
        context: options.context,
      },
    });

    return response;
  }

  /**
   * Start a new conversation and send the first message
   * 
   * @example
   * ```typescript
   * const conversation = await client.chat.startConversation('Tell me about my policies');
   * console.log('Conversation ID:', conversation.conversationId);
   * ```
   */
  async startConversation(message: string): Promise<ChatResponse> {
    return this.ask(message, {
      conversationId: crypto.randomUUID(),
    });
  }
}
