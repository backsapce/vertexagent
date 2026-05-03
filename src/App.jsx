import { useState, useCallback, useEffect, useRef } from 'react';
import ChatList from './components/ChatList/ChatList';
import MessagePanel from './components/MessagePanel/MessagePanel';
import FileManage from './components/FileManage/FileManage';
import { loadChats, saveChats, clearAll, deleteChat as deleteChatFile } from './vfs/opfs';
import config from './config/config';
import llm from './models/llm';
import { executeCommand, initAgents, cleanupE2b, enableE2b, E2B_AGENT_ID, getSandboxStatus } from './models/agent';
import { runAgentLoop } from './agent/loop';
import { ensureDefaultSkills } from './agent/skills';
import { I18nProvider } from './i18n/index';
import { useI18n } from './i18n/context';
import { WifiOff, ChevronRight } from './components/Icons/Icons';
import './App.css';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const AGENT_SYSTEM_PROMPT = `You are a helpful assistant with access to tools for executing commands, reading/writing files, and managing the filesystem. Use these tools to help the user accomplish their tasks.

Rules:
- Always explain what you're doing before and after using tools.
- Be careful with destructive operations — confirm with the user first.
- If a tool fails, explain the error and suggest alternatives.`;

function OfflineBanner() {
  const { t } = useI18n();
  return (
    <div className="offline-banner">
      <WifiOff width={16} height={16} />
      <span>{t('offline.banner')}</span>
    </div>
  );
}

function App() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [initError, setInitError] = useState(null);
  const [_llmReady, setLlmReady] = useState(false); // triggers re-render on config change
  const [streaming, setStreaming] = useState(false);
  const [theme, setTheme] = useState('system'); // 'light' | 'dark' | 'system'
  const [localePref, setLocalePref] = useState('auto'); // persisted language preference
  const [agents, setAgents] = useState([]); // [{url, name, status:'connected'|'disconnected'}]
  const [selectedAgentUrl, setSelectedAgentUrl] = useState(null); // url of active agent or null
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showFileManage, setShowFileManage] = useState(false);
  const [fileManageWidth, setFileManageWidth] = useState(320);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [nickname, setNickname] = useState('');
  const savePending = useRef(null);
  const abortRef = useRef(null);
  const streamingContentRef = useRef('');  // accumulates chunks outside React state
  const streamingThinkingRef = useRef(''); // accumulates thinking/reasoning chunks
  const rafRef = useRef(null);            // requestAnimationFrame id for UI sync
  const selectedAgentRef = useRef(null); // avoid stale closure

  // Load config, chats and LLM settings from OPFS on mount
  useEffect(() => {
    config.init()
      .then(() => {
        // Restore persisted theme preference
        const saved = config.get('theme');
        if (saved && ['light', 'dark', 'system'].includes(saved)) {
          setTheme(saved);
        }
        // Restore persisted language preference
        const savedLocale = config.get('locale');
        if (savedLocale) setLocalePref(savedLocale);
        // Restore persisted nickname
        const savedNickname = config.get('general.nickname');
        if (savedNickname) setNickname(savedNickname);
        return Promise.all([
          loadChats()
            .then((saved) => { if (saved.length) setChats(saved); })
            .catch((err) => { console.error('OPFS load failed:', err); setInitError('Failed to load chats'); }),
          llm.init()
            .then(() => setLlmReady(true))
            .catch((err) => { console.error('LLM init failed:', err); }),
        ]);
      })
      .catch((err) => {
        console.error('Config init failed:', err);
        setInitError(err.message || 'Failed to load configuration');
      })
      .finally(() => setLoaded(true));

    // Initialize agents after config is ready
    initAgents().then(({ agents: allAgents, selectedUrl }) => {
      setAgents(allAgents);
      setSelectedAgentUrl(selectedUrl);
      selectedAgentRef.current = selectedUrl;
    }).catch((err) => console.warn('Agent init failed:', err));

    // Ensure default skills exist in OPFS at startup
    ensureDefaultSkills().catch((err) => console.warn('Ensure default skills failed:', err));
  }, []);

  // Debounced save to OPFS whenever chats change
  useEffect(() => {
    if (!loaded) return;
    if (savePending.current) clearTimeout(savePending.current);
    savePending.current = setTimeout(() => {
      saveChats(chats).catch((err) => console.warn('OPFS save failed:', err));
    }, 300);
    return () => clearTimeout(savePending.current);
  }, [chats, loaded]);

  // Apply theme to <html> and listen for system preference changes
  useEffect(() => {
    const applyTheme = (mode) => {
      if (mode === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', mode);
      }
    };

    applyTheme(theme);

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (theme === 'system') applyTheme('system'); };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  const handleThemeChange = useCallback(async (newTheme) => {
    setTheme(newTheme);
    await config.set('theme', newTheme);
  }, []);

  const handleLocaleChange = useCallback(async (pref) => {
    setLocalePref(pref);
    await config.set('locale', pref);
  }, []);

  const activeChat = chats.find((c) => c.id === activeChatId);
  const messages = activeChat ? activeChat.messages : [];

  const handleNewChat = useCallback(() => {
    // If the active chat is still empty, just keep it — don't spawn another
    const current = chats.find((c) => c.id === activeChatId);
    if (current && current.messages.length === 0) return;

    const newChat = {
      id: generateId(),
      title: 'New Chat',
      lastMessage: '',
      updatedAt: formatTime(new Date()),
      messages: [],
    };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
  }, [chats, activeChatId]);

  const handleSelectChat = useCallback((chatId) => {
    setActiveChatId(chatId);
  }, []);

  const handleDeleteChat = useCallback(async (chatId) => {
    // First, delete the chat file from OPFS
    await deleteChatFile(chats, chatId);
    
    // Then update the React state
    setChats((prev) => {
      const updated = prev.filter((c) => c.id !== chatId);
      // If we deleted the active chat, select the next one (or none)
      if (chatId === activeChatId) {
        setActiveChatId(updated.length > 0 ? updated[0].id : null);
      }
      return updated;
    });
  }, [activeChatId, chats]);

  // Stream LLM response for a given chat using the agent loop
  const streamResponse = useCallback(async (chatId, chatMessages) => {
    // Prevent duplicate calls (StrictMode double-invoke guard)
    if (abortRef.current) return;

    if (!llm.isConfigured()) {
      const hintId = generateId();
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                lastMessage: 'Please configure an LLM provider in Settings.',
                updatedAt: formatTime(new Date()),
                messages: [
                  ...c.messages,
                  { id: hintId, role: 'assistant', content: 'No LLM provider configured yet. Please open Settings (gear icon) to add your API key and select a provider.' },
                ],
              }
            : c
        )
      );
      return;
    }

    const replyId = generateId();
    // Add empty assistant message for streaming
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: [...c.messages, { id: replyId, role: 'assistant', content: '', thinking: '', toolCalls: [] }],
            }
          : c
      )
    );

    const controller = new AbortController();
    abortRef.current = controller;
    streamingContentRef.current = '';
    streamingThinkingRef.current = '';
    setStreaming(true);

    // Track tool calls for this message
    const toolCalls = [];

    // Helper: update message in state
    const updateMessage = (fields) => {
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                lastMessage: (fields.content || streamingContentRef.current).slice(0, 60),
                updatedAt: formatTime(new Date()),
                messages: c.messages.map((m) =>
                  m.id === replyId ? { ...m, ...fields } : m
                ),
              }
            : c
        )
      );
    };

    // Flush accumulated content to React state via rAF for real-time char sync
    const scheduleFlush = () => {
      if (rafRef.current) return; // already scheduled
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        updateMessage({
          content: streamingContentRef.current,
          thinking: streamingThinkingRef.current,
          toolCalls: [...toolCalls],
        });
      });
    };

    try {
      const activeConfig = llm.getActiveConfig();

      const result = await runAgentLoop({
        messages: chatMessages,
        systemPrompt: selectedAgentRef.current ? AGENT_SYSTEM_PROMPT : '',
        agentUrl: selectedAgentRef.current,
        signal: controller.signal,
        provider: activeConfig.provider,
        model: activeConfig.model,
        onUpdate: ({ content, thinking, toolCalls: tcList }) => {
          streamingContentRef.current = content;
          if (thinking) streamingThinkingRef.current = thinking;
          if (tcList) {
            // Sync tool calls display by unique id
            for (const tc of tcList) {
              const existing = toolCalls.find((t) => t.id === tc.id);
              if (!existing) {
                toolCalls.push({ id: tc.id, name: tc.name, status: tc.status, result: tc.result });
              } else if (tc.result !== undefined) {
                existing.status = tc.status;
                existing.result = tc.result;
              }
            }
          }
          scheduleFlush();
        },
      });

      // Mark tool calls as completed
      for (const tc of toolCalls) {
        tc.status = 'completed';
      }

      const finalContent = result.content || streamingContentRef.current;
      const finalThinking = result.thinking || streamingThinkingRef.current;
      updateMessage({ content: finalContent, thinking: finalThinking, toolCalls: [...toolCalls], usage: result.usage });
    } catch (err) {
      if (err.name !== 'AbortError') {
        const errorContent = streamingContentRef.current || `Error: ${err.message}`;
        updateMessage({ content: errorContent, toolCalls: [...toolCalls] });
      }
    } finally {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      abortRef.current = null;
      streamingContentRef.current = '';
      streamingThinkingRef.current = '';
      setStreaming(false);
    }
  }, []);

  const handleStopStreaming = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const handleSendMessage = useCallback(
    (text, images) => {
      if (streaming) return; // prevent sending while streaming

      if (!activeChatId) {
        // Auto-create a chat if none selected
        const userMsg = { id: generateId(), role: 'user', content: text, ...(images && { images }) };
        const newChat = {
          id: generateId(),
          title: text.slice(0, 30) + (text.length > 30 ? '...' : ''),
          lastMessage: text || (images ? '[Image]' : ''),
          updatedAt: formatTime(new Date()),
          messages: [userMsg],
        };
        setChats((prev) => [newChat, ...prev]);
        setActiveChatId(newChat.id);
        // Schedule stream outside of state updater to avoid StrictMode double-fire
        setTimeout(() => streamResponse(newChat.id, [userMsg]), 0);
        return;
      }

      const userMsg = { id: generateId(), role: 'user', content: text, ...(images && { images }) };
      const chatId = activeChatId;

      setChats((prev) => {
        const updated = prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                title: c.messages.length === 0 ? text.slice(0, 30) + (text.length > 30 ? '...' : '') : c.title,
                lastMessage: text || (images ? '[Image]' : ''),
                updatedAt: formatTime(new Date()),
                messages: [...c.messages, userMsg],
              }
            : c
        );
        // Schedule stream outside of state updater
        const chat = updated.find((c) => c.id === chatId);
        if (chat) {
          setTimeout(() => streamResponse(chatId, chat.messages), 0);
        }
        return updated;
      });
    },
    [activeChatId, streaming, streamResponse]
  );

  // Track online/offline status
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // No cleanup on unmount — E2B sandbox survives page refreshes.
  // Sandbox auto-expires after 30 minutes of inactivity.

  if (!loaded) {
    return <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      {initError ? (
        <>
          <p style={{ color: '#e53935', margin: 0 }}>Initialization failed: {initError}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>Reload</button>
        </>
      ) : 'Loading...'}
    </div>;
  }

  return (
    <I18nProvider initialLocale={localePref} onLocaleChange={handleLocaleChange}>
    <div className="app">
      {isOffline && <OfflineBanner />}
      <ChatList
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        collapsed={leftPanelCollapsed}
        onToggleCollapse={() => setLeftPanelCollapsed(prev => !prev)}
      />
      {/* Expand button - visible when left panel is collapsed (PC mode only) */}
      {leftPanelCollapsed && (
        <button
          className="chat-list-expand-btn"
          onClick={() => setLeftPanelCollapsed(false)}
          aria-label="Expand chat list"
          title="Expand"
        >
          <ChevronRight width={14} height={14} />
        </button>
      )}
      <MessagePanel
        messages={messages}
        onSendMessage={handleSendMessage}
        onRetry={() => {
          const chatId = activeChatId;
          const chat = chats.find((c) => c.id === chatId);
          if (!chat) return;
          const lastUserIdx = chat.messages.reduce((acc, m, i) => m.role === 'user' ? i : acc, -1);
          if (lastUserIdx === -1) return;
          const trimmed = chat.messages.slice(0, lastUserIdx + 1);
          setChats((prev) => prev.map((c) => c.id === chatId ? { ...c, messages: trimmed } : c));
          setTimeout(() => streamResponse(chatId, trimmed), 0);
        }}
        streaming={streaming}
        onStopStreaming={handleStopStreaming}
        llmConfig={llm.getActiveConfig()}
        providers={llm.getProviders()}
        onConfigureLLM={async (cfg) => {
          await llm.configure(cfg);
          setLlmReady((prev) => !prev);
        }}
        onFetchModels={(providerId, config) => llm.fetchModels(providerId, config)}
        theme={theme}
        onThemeChange={handleThemeChange}
        agents={agents}
        selectedAgentUrl={selectedAgentUrl}
        onSelectAgent={async (url) => {
          setSelectedAgentUrl(url);
          selectedAgentRef.current = url;
          await config.set('selectedAgent', url);
        }}
        onAgentsChange={async (newAgents) => {
          // Track dismissed / un-dismissed agents for auto-detect
          const dismissed = config.get('dismissedAgents') || [];
          const nonE2bAgents = newAgents.filter((a) => a.url !== E2B_AGENT_ID);
          const removed = agents.filter((a) => a.url !== E2B_AGENT_ID && !nonE2bAgents.some((n) => n.url === a.url));
          const added = nonE2bAgents.filter((n) => !agents.some((a) => a.url === n.url && a.url !== E2B_AGENT_ID));
          let updatedDismissed = dismissed;
          if (removed.length > 0) {
            updatedDismissed = [...new Set([...updatedDismissed, ...removed.map((a) => a.url)])];
          }
          if (added.length > 0) {
            const addedUrls = new Set(added.map((a) => a.url));
            updatedDismissed = updatedDismissed.filter((u) => !addedUrls.has(u));
          }
          if (updatedDismissed.length !== dismissed.length || removed.length || added.length) {
            await config.set('dismissedAgents', updatedDismissed);
          }
          setAgents(newAgents);
          const toSave = nonE2bAgents.map(({ url, name }) => ({ url, name }));
          await config.set('agents', toSave);
          // Auto-select first connected agent when nothing is selected, or if current selection was removed
          if (!selectedAgentUrl || !newAgents.some((a) => a.url === selectedAgentUrl)) {
            const connected = newAgents.filter((a) => a.status === 'connected');
            const next = connected.length > 0 ? connected[0].url : null;
            setSelectedAgentUrl(next);
            selectedAgentRef.current = next;
            await config.set('selectedAgent', next);
          }
        }}
        onE2bChange={async (apiKey) => {
          const oldKey = config.get('e2b.apiKey');
          await config.set('e2b.apiKey', apiKey || null);
          if (apiKey && !oldKey) {
            // E2B was just enabled — start sandbox and update agent list
            const { connected, error } = await enableE2b();
            const e2bSandboxInfo = getSandboxStatus();
            const e2bAgent = { url: E2B_AGENT_ID, name: 'E2B Cloud', status: connected ? 'connected' : 'error', isE2b: true, sandboxId: e2bSandboxInfo.sandboxId };
            setAgents((prev) => {
              const updated = [...prev.filter((a) => a.url !== E2B_AGENT_ID), e2bAgent];
              if (connected) {
                // Auto-select E2B if nothing else is connected
                const hasConnected = updated.some((a) => a.status === 'connected');
                if (!hasConnected || !selectedAgentUrl) {
                  setSelectedAgentUrl(E2B_AGENT_ID);
                  selectedAgentRef.current = E2B_AGENT_ID;
                  config.set('selectedAgent', E2B_AGENT_ID);
                }
              }
              return updated;
            });
            if (error) throw new Error(`E2B sandbox failed: ${error}`);
          } else if (!apiKey && oldKey) {
            // E2B was just disabled — stop sandbox
            cleanupE2b();
            setAgents((prev) => prev.filter((a) => a.url !== E2B_AGENT_ID));
            if (selectedAgentUrl === E2B_AGENT_ID) {
              setSelectedAgentUrl(null);
              selectedAgentRef.current = null;
              config.set('selectedAgent', null);
            }
          }
        }}
        onExecuteCommand={(cmd) => executeCommand(cmd, selectedAgentUrl)}
        onFactoryReset={async () => {
          await clearAll();
          setChats([]);
          setActiveChatId(null);
          setTimeout(() => window.location.reload(), 500);
        }}
        showFileManage={showFileManage}
        onToggleFileManage={() => setShowFileManage(!showFileManage)}
        nickname={nickname}
        onNicknameChange={async (newNickname) => {
          setNickname(newNickname);
          await config.set('general.nickname', newNickname);
        }}
      />
      <FileManage
        show={showFileManage}
        onClose={() => setShowFileManage(false)}
        refreshTrigger={chats.length}
        width={fileManageWidth}
        onWidthChange={setFileManageWidth}
      />
    </div>
    </I18nProvider>
  );
}

export default App;