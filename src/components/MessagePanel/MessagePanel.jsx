import { useState, useRef, useEffect } from 'react';
import { useI18n } from '../../i18n/context';
import Settings from '../Settings/Settings';
import FileManage from '../FileManage/FileManage';
import { ChevronRight, Settings as SettingsIcon, Folder, MessageSquare, Plus, X, Send, Stop, Plug, PieChart, Cloud } from '../Icons/Icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import './MessagePanel.css';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB target (well under 10 MB API limit)
const MAX_DIMENSION = 2048;

/**
 * Compress / resize an image file so the resulting data-URL stays under the API limit.
 * Returns a base64 data-URL string.
 */
function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      // Scale down if either dimension exceeds MAX_DIMENSION
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Try JPEG at decreasing quality until under the byte limit
      let quality = 0.85;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > MAX_IMAGE_BYTES && quality > 0.1) {
        quality -= 0.15;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Fallback: read raw (will likely fail at the API, but at least doesn't block UI)
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    };
    img.src = url;
  });
}

/** Rough token estimate: ~4 chars per token */
function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) {
    if (m.content) chars += m.content.length;
    if (m.thinking) chars += m.thinking.length;
    if (m.images?.length) chars += m.images.length * 1000; // ~1k tokens per image
  }
  return Math.ceil(chars / 4);
}

const DEFAULT_CONTEXT_WINDOW = 128000; // 128k tokens default

const ContextBudget = ({ messages }) => {
  // Check if the last assistant message has real usage data from the API
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.usage);
  const estimated = estimateTokens(messages);

  let used, total, ratio, tooltip;
  if (lastAssistant?.usage) {
    const u = lastAssistant.usage;
    used = u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || u.output_tokens || 0);
    total = u.content_len || DEFAULT_CONTEXT_WINDOW;
    ratio = Math.min(used / total, 1);
    tooltip = `${formatTokens(used)} / ${formatTokens(total)}`;
  } else {
    used = estimated;
    total = DEFAULT_CONTEXT_WINDOW;
    ratio = Math.min(used / total, 1);
    tooltip = `~${formatTokens(used)} / ${formatTokens(total)} (estimated)`;
  }

  const percent = Math.round(ratio * 100);

  // Color based on usage
  let color = 'var(--color-primary)';
  if (ratio > 0.85) color = 'var(--color-error, #e53935)';
  else if (ratio > 0.6) color = 'var(--color-warning, #fb8c00)';

  function formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toString();
  }

  return (
    <div className="context-budget">
      <div className="context-budget-tooltip">{tooltip}</div>
      <div className="context-budget-pie">
        <PieChart size={26} ratio={ratio} color={color} />
        <span className="context-budget-pct" style={{ color }}>{percent}</span>
      </div>
    </div>
  );
};

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const ThinkingBlock = ({ thinking, isThinking }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const startTimeRef = useRef(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (isThinking) {
      if (!startTimeRef.current) startTimeRef.current = Date.now();
      const timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 200);
      return () => clearInterval(timer);
    } else {
      if (startTimeRef.current && thinking) {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
      startTimeRef.current = null;
    }
  }, [isThinking, thinking]);

  if (!thinking && !isThinking) return null;

  const labelText = isThinking
    ? t('message.thinking')
    : thinking
      ? t('message.thoughtFor', { seconds: formatDuration(elapsed) })
      : null;

  return (
    <div className="thinking-block">
      <button className="thinking-toggle" onClick={() => setExpanded((v) => !v)}>
        <ChevronRight className={`thinking-chevron ${expanded ? 'expanded' : ''}`} width={14} height={14} />
        <span className="thinking-label">
          {labelText}
          {isThinking && (
            <>
              {' '}
              <span className="thinking-elapsed">{formatDuration(elapsed)}</span>
              <span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
            </>
          )}
        </span>
      </button>
      {expanded && (
        <div className="thinking-content">{thinking}</div>
      )}
    </div>
  );
};

const ToolBlock = ({ toolCall }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!toolCall) return null;

  // Old execute format: { cmd, result }
  if (toolCall.cmd) {
    const { cmd, result } = toolCall;
    const hasOutput = result && (result.stdout || result.stderr);
    return (
      <div className="tool-block">
        <div className="tool-header" onClick={() => setExpanded((v) => !v)}>
          <ChevronRight className={expanded ? 'expanded' : ''} width={14} height={14} />
          <span className="tool-label">{t('message.execute')}</span>
          <span className="tool-cmd">{cmd}</span>
          {result && (
            <span className={`tool-exit-code ${result.code === 0 ? 'success' : 'error'}`}>
              {t('message.exitCode', { code: result.code })}
            </span>
          )}
          {!result && <span className="tool-exit-code">{t('message.running')}</span>}
        </div>
        {expanded && hasOutput && (
          <div className="tool-output">
            {result.stdout && <span>{result.stdout}</span>}
            {result.stderr && <span className="stderr">{result.stderr}</span>}
          </div>
        )}
      </div>
    );
  }

  // New tool call format: { name, status?, result? }
  const { name, status, result } = toolCall;
  return (
    <div className="tool-block">
      <div className="tool-header" onClick={() => setExpanded((v) => !v)}>
        <ChevronRight className={expanded ? 'expanded' : ''} width={14} height={14} />
        <span className="tool-label">{name}</span>
        {status === 'running' && <span className="tool-exit-code">{t('message.running')}</span>}
        {status === 'completed' && <span className="tool-exit-code success">{t('message.completed')}</span>}
        {status === 'error' && <span className="tool-exit-code error">{t('message.error')}</span>}
      </div>
      {expanded && result && (
        <div className="tool-output">
          <pre>{result}</pre>
        </div>
      )}
    </div>
  );
};

const MessagePanel = ({
  messages,
  onSendMessage,
  onRetry,
  streaming,
  onStopStreaming,
  llmConfig,
  providers,
  onConfigureLLM,
  onFetchModels,
  theme,
  onThemeChange,
  agents,
  selectedAgentUrl,
  onSelectAgent,
  onAgentsChange,
  onE2bChange,
  onFactoryReset,
  showFileManage,
  onToggleFileManage,
  nickname,
  onNicknameChange,
}) => {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState([]); // [{dataUrl, name}]
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || streaming) return;
    onSendMessage(text, pendingImages.length > 0 ? pendingImages : undefined);
    setInput('');
    setPendingImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      compressImage(file).then((dataUrl) => {
        setPendingImages((prev) => [...prev, { dataUrl, name: file.name }]);
      });
    });
    // Reset so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (index) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const ta = e.target;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const newVal = val.substring(0, start) + '\n' + val.substring(end);
      setInput(newVal);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 1;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  };


  return (
    <div className="message-panel">
      <Settings
        show={showSettings}
        onClose={() => setShowSettings(false)}
        llmConfig={llmConfig}
        providers={providers}
        onConfigureLLM={onConfigureLLM}
        onFetchModels={onFetchModels}
        theme={theme}
        onThemeChange={onThemeChange}
        agents={agents}
        onAgentsChange={onAgentsChange}
        onE2bChange={onE2bChange}
        onFactoryReset={onFactoryReset}
        nickname={nickname}
        onNicknameChange={onNicknameChange}
      />


      {/* Header bar with settings and file manager */}
      <div className="message-panel-header">
        <span className="model-badge">
          {llmConfig?.configured
            ? `${llmConfig.provider} / ${llmConfig.model}`
            : t('message.noProviderConfigured')}
        </span>

        <div className="header-buttons">
          <button className="settings-btn" onClick={() => setShowSettings(true)} title={t('settings.title')}>
            <SettingsIcon width={18} height={18} />
          </button>
          <button className={`filemanage-btn ${showFileManage ? 'active' : ''}`} onClick={() => onToggleFileManage?.()} title={t('filemanage.title')}>
            <Folder width={18} height={18} />
          </button>
        </div>
      </div>

      <div className="message-list">
        {messages.length === 0 ? (
          <div className="message-empty">
            <div className="message-empty-icon">
              <MessageSquare width={48} height={48} />
            </div>
            <h3>{t('app.name')}</h3>
            <p>{t('app.tagline')}</p>
            <p className="message-empty-hint">{t('app.sendHint')}</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'user' ? 'U' : 'V'}
              </div>
              <div className="message-content">
                <div className="message-role">
                  {msg.role === 'user' ? t('message.you') : t('message.assistant')}
                </div>
                {msg.role === 'assistant' && (msg.thinking || (streaming && msg.content === '')) && (
                  <ThinkingBlock thinking={msg.thinking} isThinking={streaming && msg === messages[messages.length - 1]} />
                )}
                {msg.images && msg.images.length > 0 && (
                  <div className="message-images">
                    {msg.images.map((img, i) => (
                      <img key={i} src={img.dataUrl} alt={img.name || t('message.uploaded')} className="message-image" />
                    ))}
                  </div>
                )}
                {msg.role === 'assistant' && msg.toolCalls?.length > 0 && (
                  msg.toolCalls.map((tc, i) => <ToolBlock key={tc.id || i} toolCall={tc} />)
                )}
                <div className="message-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{msg.content}</ReactMarkdown>
                  {msg.role === 'assistant' && msg.content?.startsWith('Error:') && !streaming && onRetry && (
                    <button className="retry-btn" onClick={() => onRetry()} title={t('message.retry')}>Retry</button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="message-input-area">
        {pendingImages.length > 0 && (
          <div className="image-preview-strip">
            {pendingImages.map((img, i) => (
              <div key={i} className="image-preview-item">
                <img src={img.dataUrl} alt={img.name} />
                <button className="image-preview-remove" onClick={() => removeImage(i)} title={t('message.remove')}>
                  <X width={12} height={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="message-input-wrapper">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleImageUpload}
          />
          <button
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title={t('message.uploadImage')}
            disabled={streaming}
          >
            <Plus width={20} height={20} />
          </button>
          <textarea
            ref={textareaRef}
            className="message-input"
            placeholder={t('message.placeholder')}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button
            className="send-btn"
            onClick={streaming ? onStopStreaming : handleSend}
            disabled={!streaming && !input.trim() && pendingImages.length === 0}
            title={streaming ? t('message.stop') : t('message.send')}
          >
            {streaming ? (
              <Stop width={20} height={20} />
            ) : (
              <Send width={20} height={20} />
            )}
          </button>
        </div>
        <div className="message-input-hint">
          <span>{t('message.inputHint', { modifier: /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl' })}</span>
          <div className="hint-right">
            {agents.filter((a) => a.status === 'connected').length > 0 && (() => {
              const connectedAgents = agents.filter((a) => a.status === 'connected');
              const isE2b = connectedAgents.some((a) => a.isE2b && a.url === selectedAgentUrl);
              const e2bAgent = connectedAgents.find((a) => a.isE2b && a.url === selectedAgentUrl);
              return (
                <span className={`sandbox-badge${isE2b ? ' e2b' : ''}`}>
                  <div className="sandbox-badge-tooltip">
                    {isE2b && e2bAgent?.sandboxId
                      ? `E2B Cloud — ${e2bAgent.sandboxId}`
                      : selectedAgentUrl || t('message.noSandboxSelected')}
                  </div>
                  {isE2b ? (
                    <Cloud width={14} height={14} />
                  ) : (
                    <Plug width={14} height={14} />
                  )}
                  {connectedAgents.length === 1 ? (
                    isE2b ? <span>E2B</span> : <span>{t('message.sandbox')}</span>
                  ) : (
                    <select
                      className="sandbox-select-inline"
                      value={selectedAgentUrl || ''}
                      onChange={(e) => onSelectAgent(e.target.value || null)}
                    >
                      {connectedAgents.map((a) => (
                        <option key={a.url} value={a.url}>{a.name}</option>
                      ))}
                    </select>
                  )}
                </span>
              );
            })()}
            <ContextBudget messages={messages} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessagePanel;