import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  authProviders,
  oauthBusyProvider,
  onConnectProvider,
  onDisconnectProvider,
}) {
  const providerList = Object.values(authProviders || {});

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>LLM Council</h1>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      <div className="auth-section">
        <h2>Provider OAuth</h2>
        {providerList.length === 0 ? (
          <div className="oauth-empty">Loading providers...</div>
        ) : (
          providerList.map((provider) => {
            const busy = oauthBusyProvider === provider.id;
            const connected = provider.connected;

            return (
              <div key={provider.id} className="oauth-provider-row">
                <div>
                  <div className="oauth-provider-name">{provider.name}</div>
                  <div
                    className={`oauth-provider-status ${
                      provider.configured ? 'configured' : 'not-configured'
                    }`}
                  >
                    {!provider.configured
                      ? 'Not configured'
                      : connected
                        ? 'Connected'
                        : 'Not connected'}
                  </div>
                </div>
                {connected ? (
                  <button
                    className="oauth-btn oauth-btn-disconnect"
                    onClick={() => onDisconnectProvider(provider.id)}
                    disabled={busy}
                  >
                    {busy ? '...' : 'Disconnect'}
                  </button>
                ) : (
                  <button
                    className="oauth-btn oauth-btn-connect"
                    onClick={() => onConnectProvider(provider.id)}
                    disabled={!provider.configured || busy}
                  >
                    {busy ? '...' : 'Connect'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                conv.id === currentConversationId ? 'active' : ''
              }`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <div className="conversation-title">{conv.title || 'New Conversation'}</div>
              <div className="conversation-meta">{conv.message_count} messages</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
