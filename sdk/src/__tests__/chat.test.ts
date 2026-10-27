import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatModule, type ChatResponse } from '../modules/chat';
import { HttpClient } from '../utils/http';

function createMockHttp() {
  return {
    request: vi.fn(),
    uploadFile: vi.fn(),
  } as unknown as HttpClient;
}

const mockChatResponse: ChatResponse = {
  success: true,
  response: 'Your GL coverage limit is $1,000,000.',
  conversationId: 'conv-uuid-1',
  intent: 'coverage_inquiry',
  sources: [
    { fileName: 'GL-2025.pdf', excerpt: 'Each occurrence limit: $1,000,000' },
  ],
  traceId: 'trace-1',
};

describe('ChatModule', () => {
  let http: ReturnType<typeof createMockHttp>;
  let chat: ChatModule;

  beforeEach(() => {
    http = createMockHttp();
    chat = new ChatModule(http as unknown as HttpClient);
  });

  describe('ask', () => {
    it('sends a message via POST /api/v1/chat', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(mockChatResponse);

      const result = await chat.ask('What is my GL coverage limit?');

      expect(result).toEqual(mockChatResponse);
      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/chat',
        body: {
          message: 'What is my GL coverage limit?',
          conversationId: undefined,
          context: undefined,
        },
      });
    });

    it('passes conversationId for follow-up messages', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(mockChatResponse);

      await chat.ask('And when does it expire?', {
        conversationId: 'conv-uuid-1',
      });

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/chat',
        body: {
          message: 'And when does it expire?',
          conversationId: 'conv-uuid-1',
          context: undefined,
        },
      });
    });

    it('passes context options', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(mockChatResponse);

      await chat.ask('Tell me about this policy', {
        context: {
          policyId: 'pol-1',
          documentId: 'doc-1',
        },
      });

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/chat',
        body: {
          message: 'Tell me about this policy',
          conversationId: undefined,
          context: { policyId: 'pol-1', documentId: 'doc-1' },
        },
      });
    });

    it('returns response with sources', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(mockChatResponse);

      const result = await chat.ask('What is my GL coverage limit?');

      expect(result.sources).toHaveLength(1);
      expect(result.sources![0].fileName).toBe('GL-2025.pdf');
    });

    it('returns response without sources', async () => {
      const responseWithoutSources = { ...mockChatResponse, sources: undefined };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(responseWithoutSources);

      const result = await chat.ask('Hello');

      expect(result.sources).toBeUndefined();
    });

    it('returns intent classification', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(mockChatResponse);

      const result = await chat.ask('What is my GL coverage limit?');
      expect(result.intent).toBe('coverage_inquiry');
    });
  });

  describe('startConversation', () => {
    it('calls ask with a generated conversationId', async () => {
      // Mock crypto.randomUUID
      const mockUUID = 'generated-uuid-1234';
      vi.stubGlobal('crypto', { randomUUID: () => mockUUID });

      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(mockChatResponse);

      const result = await chat.startConversation('Tell me about my policies');

      expect(result).toEqual(mockChatResponse);
      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/chat',
        body: {
          message: 'Tell me about my policies',
          conversationId: mockUUID,
          context: undefined,
        },
      });

      vi.unstubAllGlobals();
    });

    it('returns a conversationId for follow-up messages', async () => {
      vi.stubGlobal('crypto', { randomUUID: () => 'new-conv-id' });

      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...mockChatResponse,
        conversationId: 'server-conv-id',
      });

      const result = await chat.startConversation('Hello');

      expect(result.conversationId).toBe('server-conv-id');

      vi.unstubAllGlobals();
    });
  });
});
