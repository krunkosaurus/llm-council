import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import { api } from './api';
import './App.css';

const ACTIVE_CONVERSATION_STORAGE_KEY = 'llm-council.currentConversationId';

function conversationHasPendingAssistant(conversation) {
  if (!conversation || !Array.isArray(conversation.messages)) {
    return false;
  }

  return conversation.messages.some(
    (message) =>
      message &&
      message.role === 'assistant' &&
      message.loading &&
      (message.loading.stage1 || message.loading.stage2 || message.loading.stage3)
  );
}

function conversationLooksInterrupted(conversation) {
  if (!conversation || !Array.isArray(conversation.messages) || conversation.messages.length === 0) {
    return false;
  }

  const lastMessage = conversation.messages[conversation.messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    return false;
  }

  return !conversation.messages.some((message) => message && message.role === 'assistant');
}

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authProviders, setAuthProviders] = useState({});
  const [oauthBusyProvider, setOauthBusyProvider] = useState(null);
  const [providerModelBusy, setProviderModelBusy] = useState(null);
  const [deletingConversationId, setDeletingConversationId] = useState(null);
  const [pendingCodeOAuth, setPendingCodeOAuth] = useState(null);
  const [pendingOAuthCode, setPendingOAuthCode] = useState('');
  const [oauthError, setOauthError] = useState(null);

  // Load conversations and auth status on mount
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [convs, providers] = await Promise.all([
          api.listConversations(),
          api.getAuthProviders(),
        ]);
        setConversations(convs);
        setAuthProviders(providers);

        const storedConversationId = window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
        const initialConversationId = convs.some((conv) => conv.id === storedConversationId)
          ? storedConversationId
          : convs[0]?.id || null;

        if (initialConversationId) {
          setCurrentConversationId(initialConversationId);
        }
      } catch (error) {
        console.error('Failed to load initial app data:', error);
      }
    };

    loadInitialData();
  }, []);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  useEffect(() => {
    if (currentConversationId) {
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, currentConversationId);
    } else {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    }
  }, [currentConversationId]);

  useEffect(() => {
    if (
      !currentConversationId ||
      (!conversationHasPendingAssistant(currentConversation) && !conversationLooksInterrupted(currentConversation))
    ) {
      return undefined;
    }

    setIsLoading(true);

    const poll = window.setInterval(() => {
      loadConversation(currentConversationId);
      loadConversations();
    }, 2000);

    return () => window.clearInterval(poll);
  }, [currentConversationId, currentConversation]);

  useEffect(() => {
    if (
      !conversationHasPendingAssistant(currentConversation) &&
      !conversationLooksInterrupted(currentConversation)
    ) {
      setIsLoading(false);
    }
  }, [currentConversation]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const loadAuthProviders = async () => {
    try {
      const providers = await api.getAuthProviders();
      setAuthProviders(providers);
      if (pendingCodeOAuth && providers[pendingCodeOAuth.providerId]?.connected) {
        setPendingCodeOAuth(null);
        setPendingOAuthCode('');
        setOauthError(null);
      }
      return providers;
    } catch (error) {
      console.error('Failed to load auth providers:', error);
      return null;
    }
  };

  const handleNewConversation = async () => {
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleDeleteConversation = async (conversationId) => {
    if (!conversationId || deletingConversationId) {
      return;
    }

    const confirmed = window.confirm('Delete this conversation? This cannot be undone.');
    if (!confirmed) {
      return;
    }

    setDeletingConversationId(conversationId);

    try {
      await api.deleteConversation(conversationId);
      const updatedConversations = await api.listConversations();
      setConversations(updatedConversations);

      if (currentConversationId === conversationId) {
        const nextConversationId = updatedConversations[0]?.id || null;
        setCurrentConversationId(nextConversationId);
        if (!nextConversationId) {
          setCurrentConversation(null);
        }
      }
    } catch (error) {
      console.error(`Failed to delete conversation ${conversationId}:`, error);
    } finally {
      setDeletingConversationId(null);
    }
  };

  const handleConnectProvider = async (providerId) => {
    setOauthBusyProvider(providerId);
    setOauthError(null);

    try {
      const provider = authProviders && authProviders[providerId];
      if (provider && (provider.connect_method === 'env' || provider.connect_method === 'config')) {
        await api.connectOAuth(providerId);
        await loadAuthProviders();
        setOauthBusyProvider(null);
        return;
      }

      const start = await api.startOAuth(providerId);
      const authUrl = start.auth_url;

      if (start.method === 'code') {
        const popup = window.open(authUrl, `oauth-${providerId}`, 'width=680,height=840');
        setPendingCodeOAuth({
          providerId,
          flowId: start.flow_id,
          authUrl,
          instructions: start.instructions,
        });
        setPendingOAuthCode('');
        if (popup) {
          popup.focus();
        }
        setOauthBusyProvider(null);
        return;
      }

      const popup = window.open(authUrl, `oauth-${providerId}`, 'width=520,height=720');

      // Fallback if browser blocks popups
      if (!popup) {
        window.location.href = authUrl;
        return;
      }

      const poll = window.setInterval(async () => {
        try {
          if (popup.closed) {
            window.clearInterval(poll);
            await loadAuthProviders();
            setOauthBusyProvider(null);
            return;
          }

          const latest = await loadAuthProviders();
          if (latest && latest[providerId] && latest[providerId].connected) {
            window.clearInterval(poll);
            popup.close();
            setOauthBusyProvider(null);
          }
        } catch (e) {
          console.error(`Failed polling OAuth status for ${providerId}:`, e);
        }
      }, 1200);
    } catch (error) {
      console.error(`Failed to connect ${providerId}:`, error);
      setOauthBusyProvider(null);
    }
  };

  const handlePendingOAuthCodeSubmit = async () => {
    if (!pendingCodeOAuth || !pendingOAuthCode.trim()) {
      return;
    }

    setOauthBusyProvider(pendingCodeOAuth.providerId);
    setOauthError(null);

    try {
      await api.completeOAuth(pendingCodeOAuth.providerId, {
        flow_id: pendingCodeOAuth.flowId,
        code: pendingOAuthCode.trim(),
      });
      setPendingCodeOAuth(null);
      setPendingOAuthCode('');
      await loadAuthProviders();
    } catch (error) {
      console.error(`Failed to complete ${pendingCodeOAuth.providerId} OAuth:`, error);
      setOauthError(error.message);
    } finally {
      setOauthBusyProvider(null);
    }
  };

  const handlePendingOAuthCancel = () => {
    setPendingCodeOAuth(null);
    setPendingOAuthCode('');
    setOauthError(null);
  };

  const handleDisconnectProvider = async (providerId) => {
    setOauthBusyProvider(providerId);

    try {
      await api.disconnectOAuth(providerId);
      if (pendingCodeOAuth && pendingCodeOAuth.providerId === providerId) {
        setPendingCodeOAuth(null);
        setPendingOAuthCode('');
        setOauthError(null);
      }
      await loadAuthProviders();
    } catch (error) {
      console.error(`Failed to disconnect ${providerId}:`, error);
    } finally {
      setOauthBusyProvider(null);
    }
  };

  const handleProviderModelChange = async (providerId, modelId) => {
    setProviderModelBusy(providerId);

    try {
      const result = await api.setProviderModel(providerId, modelId);
      if (result && result.provider) {
        setAuthProviders((prev) => ({
          ...prev,
          [providerId]: result.provider,
        }));
      } else {
        await loadAuthProviders();
      }
    } catch (error) {
      console.error(`Failed to update model for ${providerId}:`, error);
    } finally {
      setProviderModelBusy(null);
    }
  };

  const handleRefreshProviderModels = async (providerId) => {
    setProviderModelBusy(providerId);

    try {
      const result = await api.refreshProviderModels(providerId);
      if (result && result.provider) {
        setAuthProviders((prev) => ({
          ...prev,
          [providerId]: result.provider,
        }));
      } else {
        await loadAuthProviders();
      }
    } catch (error) {
      console.error(`Failed to refresh models for ${providerId}:`, error);
    } finally {
      setProviderModelBusy(null);
    }
  };

  const handleSendMessage = async (content) => {
    if (!currentConversationId || !currentConversation) return;

    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: {
          stage1: true,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Send message with streaming
      await api.sendMessageStream(currentConversationId, content, (eventType, event) => {
        switch (eventType) {
          case 'stage1_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage1 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage1 = event.data;
              lastMsg.metadata = {
                ...(lastMsg.metadata || {}),
                ...((event && event.metadata) || {}),
              };
              lastMsg.loading.stage1 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage2_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage2 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage2 = event.data;
              lastMsg.metadata = {
                ...(lastMsg.metadata || {}),
                ...((event && event.metadata) || {}),
              };
              lastMsg.loading.stage2 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage3_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage3 = event.data;
              lastMsg.loading.stage3 = false;
              return { ...prev, messages };
            });
            break;

          case 'title_complete':
            // Reload conversations to get updated title
            loadConversations();
            break;

          case 'complete':
            // Stream complete, reload conversations list
            loadConversations();
            setIsLoading(false);
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setIsLoading(false);
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onNewConversation={handleNewConversation}
        authProviders={authProviders}
        oauthBusyProvider={oauthBusyProvider}
        providerModelBusy={providerModelBusy}
        deletingConversationId={deletingConversationId}
        onConnectProvider={handleConnectProvider}
        onDisconnectProvider={handleDisconnectProvider}
        onProviderModelChange={handleProviderModelChange}
        onRefreshProviderModels={handleRefreshProviderModels}
        pendingCodeOAuth={pendingCodeOAuth}
        pendingOAuthCode={pendingOAuthCode}
        oauthError={oauthError}
        onPendingOAuthCodeChange={setPendingOAuthCode}
        onPendingOAuthCodeSubmit={handlePendingOAuthCodeSubmit}
        onPendingOAuthCancel={handlePendingOAuthCancel}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
      />
    </div>
  );
}

export default App;
