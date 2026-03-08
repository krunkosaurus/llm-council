/**
 * API client for the LLM Council backend.
 */

const devApiBase =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:8001`
    : 'http://localhost:8001';
const rawApiBase = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? devApiBase : '');
const API_BASE = rawApiBase.replace(/\/+$/, '');

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}`);
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, onEvent) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/message/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processEventBlock = (block) => {
      const lines = block.split('\n');
      const dataLines = [];

      for (const line of lines) {
        if (line.startsWith('data:')) {
          dataLines.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5));
        }
      }

      if (dataLines.length === 0) {
        return;
      }

      try {
        const event = JSON.parse(dataLines.join('\n'));
        onEvent(event.type, event);
      } catch (e) {
        console.error('Failed to parse SSE event:', e);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        processEventBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, '\n');
    if (buffer.trim()) {
      processEventBlock(buffer);
    }
  },

  /**
   * Get OAuth connection status for supported providers.
   */
  async getAuthProviders() {
    const response = await fetch(`${API_BASE}/api/auth/providers`);
    if (!response.ok) {
      throw new Error('Failed to get auth providers');
    }
    return response.json();
  },

  /**
   * Start OAuth for provider and return authorization URL.
   */
  async startOAuth(provider) {
    const response = await fetch(`${API_BASE}/api/auth/${provider}/start`);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error((data && data.detail) || `Failed to start OAuth for ${provider}`);
    }
    return response.json();
  },

  /**
   * Complete a code-based OAuth flow.
   */
  async completeOAuth(provider, payload) {
    const response = await fetch(`${API_BASE}/api/auth/${provider}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error((data && data.detail) || `Failed to complete OAuth for ${provider}`);
    }
    return response.json();
  },

  /**
   * Disconnect OAuth token for provider.
   */
  async disconnectOAuth(provider) {
    const response = await fetch(`${API_BASE}/api/auth/${provider}/disconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error((data && data.detail) || `Failed to disconnect ${provider}`);
    }

    return response.json();
  },

  /**
   * Update selected model for a provider.
   */
  async setProviderModel(provider, model) {
    const response = await fetch(`${API_BASE}/api/auth/${provider}/model`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error((data && data.detail) || `Failed to set model for ${provider}`);
    }

    return response.json();
  },
};
