import { useState, useRef, useEffect } from 'react';
import { checkAgentAvailable, connectAgent } from '../../models/agent';
import { exportToZip, importFromZip } from '../../vfs/opfs';
import { useI18n } from '../../i18n/context';
import { SUPPORTED_LOCALES } from '../../i18n/locales';
import { X, Lock, Plug, Sun, Moon, Monitor, UploadCloud, DownloadCloud, AlertTriangle, Globe, ChevronDown, User, Cloud, Layers } from '../Icons/Icons';
import { listAllSkills, setSkillEnabled } from '../../agent/skills';
import './Settings.css';

const Settings = ({
  show,
  onClose,
  llmConfig,
  providers,
  onConfigureLLM,
  onFetchModels,
  theme,
  onThemeChange,
  agents,
  onAgentsChange,
  onE2bChange,
  onFactoryReset,
  nickname,
  onNicknameChange,
}) => {
  const { t, localePref, changeLocale } = useI18n();
  const [settingsTab, setSettingsTab] = useState('llm');
  const [settingsForm, setSettingsForm] = useState({
    provider: '',
    apiKey: '',
    baseUrl: '',
    model: '',
  });
  const [modelList, setModelList] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelComboRef = useRef(null);
  const [newAgentUrl, setNewAgentUrl] = useState('');
  const [newAgentChecking, setNewAgentChecking] = useState(false);
  const [newAgentError, setNewAgentError] = useState(null);
  const [connectTokenInput, setConnectTokenInput] = useState('');
  const [connectingAgent, setConnectingAgent] = useState(null);
  const [connectError, setConnectError] = useState(null);
  const [dataExporting, setDataExporting] = useState(false);
  const [dataImporting, setDataImporting] = useState(false);
  const [dataMessage, setDataMessage] = useState(null);
  const [factoryResetting, setFactoryResetting] = useState(false);
  const zipInputRef = useRef(null);
  const [localNickname, setLocalNickname] = useState(nickname || '');
  const [agentAddMode, setAgentAddMode] = useState('server'); // 'server' | 'e2b'
  const [e2bApiKeyInput, setE2bApiKeyInput] = useState('');
  const [e2bEnabling, setE2bEnabling] = useState(false);
  const [e2bLocalError, setE2bLocalError] = useState(null);
  const [skillsList, setSkillsList] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);

  // Load skills when tab changes to skills
  useEffect(() => {
    if (settingsTab === 'skills') {
      setSkillsLoading(true);
      listAllSkills()
        .then((skills) => setSkillsList(skills))
        .catch((err) => console.error('Failed to load skills:', err))
        .finally(() => setSkillsLoading(false));
    }
  }, [settingsTab]);

  const handleSkillToggle = async (skillName, enabled) => {
    await setSkillEnabled(skillName, enabled);
    setSkillsList((prev) => prev.map((s) => (s.name === skillName ? { ...s, enabled } : s)));
  };

  const handleBulkToggle = async (enabled) => {
    for (const skill of skillsList) {
      await setSkillEnabled(skill.name, enabled);
    }
    setSkillsList((prev) => prev.map((s) => ({ ...s, enabled })));
  };

  // Initialize form when opening
  useEffect(() => {
    if (!show) return;
    setLocalNickname(nickname || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Initialize form when opening
  useEffect(() => {
    if (!show) return;
    if (llmConfig) {
      setSettingsForm({
        provider: llmConfig.provider || '',
        apiKey: '',
        baseUrl: llmConfig.baseUrl || '',
        model: llmConfig.model || '',
      });
    }
    setModelList([]);
    setModelsError(null);
    // Auto-fetch models if provider is configured with a saved key
    if (llmConfig?.provider && llmConfig?.hasApiKey) {
      fetchModels(llmConfig.provider, '', llmConfig.baseUrl || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Close settings panel on Escape key
  useEffect(() => {
    if (!show) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose]);

  // Close model dropdown on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handleClick = (e) => {
      if (modelComboRef.current && !modelComboRef.current.contains(e.target)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [modelDropdownOpen]);

  const fetchModels = async (providerId, apiKey, baseUrl) => {
    if (!providerId) {
      setModelList([]);
      return;
    }
    if (!apiKey && !llmConfig?.hasApiKey) {
      setModelList([]);
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const models = await onFetchModels(providerId, { apiKey, baseUrl: baseUrl || null });
      setModelList(models || []);
    } catch (err) {
      setModelsError(err.message);
      setModelList([]);
    } finally {
      setModelsLoading(false);
    }
  };

  const selectedProvider = providers?.find((p) => p.id === settingsForm.provider);

  const handleAddAgent = async () => {
    const url = newAgentUrl.trim().replace(/\/+$/, '');
    if (!url) return;
    if (agents.some((a) => a.url === url)) {
      setNewAgentError(t('agentSettings.alreadyAdded'));
      return;
    }
    setNewAgentChecking(true);
    setNewAgentError(null);
    try {
      const info = await checkAgentAvailable(url);
      if (!info.available) {
        setNewAgentError(t('agentSettings.connectFailed'));
        return;
      }
      let name;
      try {
        const u = new URL(url);
        name = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
          ? `Local (${u.port || '80'})` : u.hostname;
      } catch {
        name = url;
      }

      if (info.needsAuth) {
        const newAgent = { url, name, status: 'needsAuth' };
        onAgentsChange([...agents, newAgent]);
        setNewAgentUrl('');
        setConnectingAgent(url);
        setConnectTokenInput('');
        setConnectError(null);
      } else {
        const newAgent = { url, name, status: 'connected' };
        onAgentsChange([...agents, newAgent]);
        setNewAgentUrl('');
      }
    } finally {
      setNewAgentChecking(false);
    }
  };

  const handleConnectWithToken = async (url) => {
    const token = connectTokenInput.trim();
    if (!token) return;
    setConnectError(null);
    try {
      await connectAgent(token, url);
      onAgentsChange(agents.map((a) =>
        a.url === url ? { ...a, status: 'connected' } : a
      ));
      setConnectingAgent(null);
      setConnectTokenInput('');
    } catch (err) {
      setConnectError(err.message);
    }
  };

  const handleRemoveAgent = (url) => {
    onAgentsChange(agents.filter((a) => a.url !== url));
  };

  const handleEnableE2b = async () => {
    if (!e2bApiKeyInput.trim() || !onE2bChange) return;
    setE2bEnabling(true);
    setE2bLocalError(null);
    try {
      await onE2bChange(e2bApiKeyInput.trim());
      setE2bApiKeyInput('');
    } catch (err) {
      setE2bLocalError(err.message);
    } finally {
      setE2bEnabling(false);
    }
  };

  const handleProviderChange = (e) => {
    const newProvider = e.target.value;
    setSettingsForm((f) => ({ ...f, provider: newProvider, model: '', baseUrl: '' }));
    setModelList([]);
    setModelsError(null);
    const key = settingsForm.apiKey;
    if (newProvider && (key || llmConfig?.hasApiKey)) {
      fetchModels(newProvider, key, '');
    }
  };

  const handleApiKeyBlur = () => {
    if (settingsForm.provider && settingsForm.apiKey) {
      fetchModels(settingsForm.provider, settingsForm.apiKey, settingsForm.baseUrl);
    }
  };

  const handleBaseUrlBlur = () => {
    if (settingsForm.provider && (settingsForm.apiKey || llmConfig?.hasApiKey)) {
      fetchModels(settingsForm.provider, settingsForm.apiKey, settingsForm.baseUrl);
    }
  };

  const handleSaveSettings = async () => {
    if (!settingsForm.provider) return;
    await onConfigureLLM({
      provider: settingsForm.provider,
      ...(settingsForm.apiKey && { apiKey: settingsForm.apiKey }),
      baseUrl: settingsForm.baseUrl || null,
      model: settingsForm.model || null,
    });
    onClose();
  };

  if (!show) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <button className="settings-close-btn" onClick={onClose}>
          <X width={18} height={18} />
        </button>
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">
            <h3>{t('settings.title')}</h3>
          </div>
          <nav className="settings-nav">
            <button
              className={`settings-nav-item ${settingsTab === 'llm' ? 'active' : ''}`}
              onClick={() => setSettingsTab('llm')}
            >
              <Lock width={16} height={16} />
              {t('settings.llm')}
            </button>
            <button
              className={`settings-nav-item ${settingsTab === 'general' ? 'active' : ''}`}
              onClick={() => setSettingsTab('general')}
            >
              <User width={16} height={16} />
              {t('settings.general')}
            </button>
            <button
              className={`settings-nav-item ${settingsTab === 'agents' ? 'active' : ''}`}
              onClick={() => setSettingsTab('agents')}
            >
              <Plug width={16} height={16} />
              {t('settings.agents')}
              {agents.filter((a) => a.status === 'connected').length > 0 && (
                <span className="settings-nav-count">{agents.filter((a) => a.status === 'connected').length}</span>
              )}
            </button>
            <button
              className={`settings-nav-item ${settingsTab === 'appearance' ? 'active' : ''}`}
              onClick={() => setSettingsTab('appearance')}
            >
              <Sun width={16} height={16} />
              {t('settings.appearance')}
            </button>
            <button
              className={`settings-nav-item ${settingsTab === 'data' ? 'active' : ''}`}
              onClick={() => { setSettingsTab('data'); setDataMessage(null); }}
            >
              <UploadCloud width={16} height={16} />
              {t('settings.data')}
            </button>
            <button
              className={`settings-nav-item ${settingsTab === 'language' ? 'active' : ''}`}
              onClick={() => setSettingsTab('language')}
            >
              <Globe width={16} height={16} />
              {t('settings.language')}
            </button>
            <button
              className={`settings-nav-item ${settingsTab === 'skills' ? 'active' : ''}`}
              onClick={() => setSettingsTab('skills')}
            >
              <Layers width={16} height={16} />
              {t('settings.skills')}
            </button>
          </nav>
        </div>
        <div className="settings-content">
          {settingsTab === 'llm' && (
            <div className="settings-section">
              <h3>{t('llmSettings.title')}</h3>
              <p className="settings-desc">{t('llmSettings.desc')}</p>

              <label>{t('llmSettings.provider')}</label>
              <select
                value={settingsForm.provider}
                onChange={handleProviderChange}
              >
                <option value="">{t('llmSettings.selectProvider')}</option>
                {providers?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              <label>{t('llmSettings.apiKey')}</label>
              <input
                type="password"
                placeholder={llmConfig?.hasApiKey ? t('llmSettings.apiKeyMask') : t('llmSettings.enterApiKey')}
                value={settingsForm.apiKey}
                onChange={(e) => setSettingsForm((f) => ({ ...f, apiKey: e.target.value }))}
                onBlur={handleApiKeyBlur}
              />
              {llmConfig?.hasApiKey && !settingsForm.apiKey && (
                <p className="settings-hint">{t('llmSettings.apiKeySaved')}</p>
              )}

              {selectedProvider && (
                <>
                  {selectedProvider.requiresBaseUrl && (
                    <>
                      <label>{t('llmSettings.baseUrl')} <span className="required-tag">*</span></label>
                      <input
                        type="text"
                        placeholder={t('llmSettings.customEndpoint')}
                        value={settingsForm.baseUrl}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, baseUrl: e.target.value }))}
                        onBlur={handleBaseUrlBlur}
                      />
                      <p className="settings-hint">{t('llmSettings.baseUrlRequiredHint')}</p>
                    </>
                  )}

                  <label>
                    {t('llmSettings.model')}
                    {modelsLoading && <span className="models-loading-tag">{t('llmSettings.modelsLoading')}</span>}
                  </label>
                  {modelsError && (
                    <p className="settings-error">{t('llmSettings.modelsError', { error: modelsError })}</p>
                  )}
                  <div className="model-select-row">
                    <div className="model-combo" ref={modelComboRef}>
                      <input
                        type="text"
                        className="model-combo-input"
                        value={settingsForm.model}
                        placeholder={selectedProvider.defaultModel || t('llmSettings.modelPlaceholder', { fallback: 'Type or select a model' })}
                        onChange={(e) => {
                          setSettingsForm((f) => ({ ...f, model: e.target.value }));
                          setModelDropdownOpen(true);
                        }}
                        onFocus={() => setModelDropdownOpen(true)}
                        disabled={modelsLoading}
                      />
                      <button
                        type="button"
                        className="model-combo-toggle"
                        tabIndex={-1}
                        onClick={() => setModelDropdownOpen((v) => !v)}
                        disabled={modelsLoading}
                      >
                        <ChevronDown width={10} height={10} />
                      </button>
                      {modelDropdownOpen && (() => {
                        const allModels = modelList.length > 0 ? modelList : (selectedProvider.fallbackModels || []);
                        const filter = settingsForm.model.toLowerCase();
                        const filtered = filter
                          ? allModels.filter((m) => m.id.toLowerCase().includes(filter) || m.name.toLowerCase().includes(filter))
                          : allModels;
                        return filtered.length > 0 ? (
                          <ul className="model-combo-dropdown">
                            {filtered.map((m) => (
                              <li
                                key={m.id}
                                className={`model-combo-option${m.id === settingsForm.model ? ' selected' : ''}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setSettingsForm((f) => ({ ...f, model: m.id }));
                                  setModelDropdownOpen(false);
                                }}
                              >{m.name}</li>
                            ))}
                          </ul>
                        ) : null;
                      })()}
                    </div>

                  </div>
                  {modelList.length === 0 && !modelsLoading && settingsForm.apiKey && (
                    <p className="settings-hint">{t('llmSettings.modelsHint')}</p>
                  )}

                  {!selectedProvider.requiresBaseUrl && (
                    <>
                      <label>{t('llmSettings.baseUrl')} <span className="optional-tag">{t('llmSettings.optional')}</span></label>
                      <input
                        type="text"
                        placeholder={selectedProvider.defaultBaseUrl || t('llmSettings.customEndpoint')}
                        value={settingsForm.baseUrl}
                        onChange={(e) => setSettingsForm((f) => ({ ...f, baseUrl: e.target.value }))}
                        onBlur={handleBaseUrlBlur}
                      />
                      <p className="settings-hint">{t('llmSettings.baseUrlHint')}</p>
                    </>
                  )}
                </>
              )}

              <div className="settings-actions">
                <button className="settings-cancel" onClick={onClose}>{t('settings.cancel')}</button>
                <button className="settings-save" onClick={handleSaveSettings} disabled={!settingsForm.provider || (selectedProvider?.requiresBaseUrl && !settingsForm.baseUrl.trim())}>{t('settings.save')}</button>
              </div>
            </div>
          )}
          {settingsTab === 'general' && (
            <div className="settings-section">
              <h3>{t('generalSettings.title')}</h3>
              <p className="settings-desc">{t('generalSettings.desc')}</p>

              <label>{t('generalSettings.nickname')}</label>
              <input
                type="text"
                placeholder={t('generalSettings.nicknamePlaceholder')}
                value={localNickname}
                onChange={(e) => setLocalNickname(e.target.value)}
              />
              <p className="settings-hint">{t('generalSettings.nicknameHint')}</p>

              <div className="settings-actions">
                <button className="settings-cancel" onClick={onClose}>{t('settings.cancel')}</button>
                <button
                  className="settings-save"
                  onClick={() => {
                    onNicknameChange?.(localNickname);
                    onClose();
                  }}
                >
                  {t('settings.save')}
                </button>
              </div>
            </div>
          )}
          {settingsTab === 'agents' && (
            <div className="settings-section">
              <h3>{t('agentSettings.title')}</h3>
              <p className="settings-desc">{t('agentSettings.desc')}</p>

              <div className="agents-list">
                {agents.length === 0 && (
                  <div className="agents-empty">{t('agentSettings.empty')}</div>
                )}
                {agents.map((agent) => (
                  <div key={agent.url} className={`agent-item ${agent.status}${agent.isE2b ? ' e2b' : ''}`}>
                    <div className="agent-item-info">
                      <span className={`agent-status-dot ${agent.status}${agent.isE2b ? ' e2b' : ''}`} />
                      <div className="agent-item-details">
                        <span className="agent-item-name">{agent.name}</span>
                        <span className="agent-item-url">{agent.isE2b ? (agent.sandboxId || t('agentSettings.e2bNotStarted')) : agent.url}</span>
                      </div>
                    </div>
                    {agent.isE2b && agent.status === 'connected' && (
                      <button
                        className="agent-remove-btn"
                        onClick={async () => {
                          // Disable E2B: clear key and cleanup
                          await onE2bChange('');
                        }}
                        title={t('agentSettings.removeAgent')}
                      >
                        <X width={14} height={14} />
                      </button>
                    )}
                    {!agent.isE2b && (
                      <button className="agent-remove-btn" onClick={() => handleRemoveAgent(agent.url)} title={t('agentSettings.removeAgent')}>
                        <X width={14} height={14} />
                      </button>
                    )}
                    {agent.status === 'needsAuth' && connectingAgent !== agent.url && (
                      <button
                        className="agent-connect-btn"
                        onClick={() => { setConnectingAgent(agent.url); setConnectTokenInput(''); setConnectError(null); }}
                      >
                        {t('agentSettings.authenticate')}
                      </button>
                    )}
                    {connectingAgent === agent.url && (
                      <div className="agent-token-row">
                        <input
                          type="text"
                          placeholder={t('agentSettings.enterToken')}
                          value={connectTokenInput}
                          onChange={(e) => { setConnectTokenInput(e.target.value); setConnectError(null); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleConnectWithToken(agent.url); }}
                          autoFocus
                        />
                        <button onClick={() => handleConnectWithToken(agent.url)} disabled={!connectTokenInput.trim()}>
                          {t('agentSettings.submit')}
                        </button>
                        <button className="agent-token-cancel" onClick={() => setConnectingAgent(null)}>{t('agentSettings.cancel')}</button>
                        {connectError && <p className="settings-error">{connectError}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <label>{t('agentSettings.addAgent')}</label>
              <div className="agent-mode-selector">
                <button
                  className={`agent-mode-btn ${agentAddMode === 'server' ? 'active' : ''}`}
                  onClick={() => setAgentAddMode('server')}
                >
                  <Plug width={14} height={14} />
                  {t('agentSettings.modeServer')}
                </button>
                <button
                  className={`agent-mode-btn ${agentAddMode === 'e2b' ? 'active' : ''}`}
                  onClick={() => setAgentAddMode('e2b')}
                >
                  <Cloud width={14} height={14} />
                  {t('agentSettings.modeE2b')}
                </button>
              </div>

              {agentAddMode === 'server' && (
                <>
                  <div className="agent-add-row">
                    <input
                      type="text"
                      placeholder={t('agentSettings.hostPlaceholder')}
                      value={newAgentUrl}
                      onChange={(e) => { setNewAgentUrl(e.target.value); setNewAgentError(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddAgent(); }}
                    />
                    <button
                      className="agent-add-btn"
                      onClick={handleAddAgent}
                      disabled={newAgentChecking || !newAgentUrl.trim()}
                    >
                      {newAgentChecking ? t('agentSettings.checking') : t('agentSettings.connect')}
                    </button>
                  </div>
                  {newAgentError && <p className="settings-error">{newAgentError}</p>}
                  <p className="settings-hint">{t('agentSettings.hint')}</p>
                </>
              )}

              {agentAddMode === 'e2b' && (
                <>
                  <div className="e2b-add-row">
                    <input
                      type="password"
                      placeholder={t('e2bSettings.apiKeyPlaceholder')}
                      value={e2bApiKeyInput}
                      onChange={(e) => { setE2bApiKeyInput(e.target.value); setE2bLocalError(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleEnableE2b(); }}
                    />
                    <button
                      className="e2b-add-btn"
                      disabled={e2bEnabling || !e2bApiKeyInput.trim()}
                      onClick={handleEnableE2b}
                    >
                      {e2bEnabling ? t('e2bSettings.starting') : t('e2bSettings.enable')}
                    </button>
                  </div>
                  {e2bLocalError && <p className="settings-error">{e2bLocalError}</p>}
                  <p className="settings-hint">{t('e2bSettings.hint')}</p>
                </>
              )}
            </div>
          )}
          {settingsTab === 'data' && (
            <div className="settings-section">
              <h3>{t('dataSettings.title')}</h3>
              <p className="settings-desc">{t('dataSettings.desc')}</p>

              {dataMessage && (
                <p className={`settings-${dataMessage.type === 'error' ? 'error' : 'success'}`}>{dataMessage.text}</p>
              )}

              <div className="data-actions">
                <div className="data-action-card">
                  <div className="data-action-icon">
                    <UploadCloud width={24} height={24} />
                  </div>
                  <div className="data-action-info">
                    <span className="data-action-title">{t('dataSettings.exportTitle')}</span>
                    <span className="data-action-desc">{t('dataSettings.exportDesc')}</span>
                  </div>
                  <button
                    className="data-action-btn"
                    disabled={dataExporting}
                    onClick={async () => {
                      setDataExporting(true);
                      setDataMessage(null);
                      try {
                        const blob = await exportToZip();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `vertex-agent-backup-${new Date().toISOString().slice(0, 10)}.zip`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        setDataMessage({ type: 'success', text: t('dataSettings.exportSuccess') });
                      } catch (err) {
                        setDataMessage({ type: 'error', text: t('dataSettings.exportFailed', { error: err.message }) });
                      } finally {
                        setDataExporting(false);
                      }
                    }}
                  >
                    {dataExporting ? t('dataSettings.exporting') : t('dataSettings.export')}
                  </button>
                </div>

                <div className="data-action-card">
                  <div className="data-action-icon">
                    <DownloadCloud width={24} height={24} />
                  </div>
                  <div className="data-action-info">
                    <span className="data-action-title">{t('dataSettings.importTitle')}</span>
                    <span className="data-action-desc">{t('dataSettings.importDesc')}</span>
                  </div>
                  <input
                    ref={zipInputRef}
                    type="file"
                    accept=".zip"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setDataImporting(true);
                      setDataMessage(null);
                      try {
                        await importFromZip(file);
                        setDataMessage({ type: 'success', text: t('dataSettings.importSuccess') });
                      } catch (err) {
                        setDataMessage({ type: 'error', text: t('dataSettings.importFailed', { error: err.message }) });
                      } finally {
                        setDataImporting(false);
                        if (zipInputRef.current) zipInputRef.current.value = '';
                      }
                    }}
                  />
                  <button
                    className="data-action-btn"
                    disabled={dataImporting}
                    onClick={() => zipInputRef.current?.click()}
                  >
                    {dataImporting ? t('dataSettings.importing') : t('dataSettings.import')}
                  </button>
                </div>

                <div className="data-action-card danger">
                  <div className="data-action-icon danger">
                    <AlertTriangle width={24} height={24} />
                  </div>
                  <div className="data-action-info">
                    <span className="data-action-title danger">{t('dataSettings.factoryResetTitle')}</span>
                    <span className="data-action-desc">{t('dataSettings.factoryResetDesc')}</span>
                  </div>
                  <button
                    className="data-action-btn danger"
                    disabled={factoryResetting}
                    onClick={async () => {
                      if (!window.confirm(t('dataSettings.factoryResetConfirm'))) return;
                      setFactoryResetting(true);
                      setDataMessage(null);
                      try {
                        await onFactoryReset();
                        setDataMessage({ type: 'success', text: t('dataSettings.factoryResetSuccess') });
                      } catch (err) {
                        setDataMessage({ type: 'error', text: t('dataSettings.factoryResetFailed', { error: err.message }) });
                      } finally {
                        setFactoryResetting(false);
                      }
                    }}
                  >
                    {factoryResetting ? t('dataSettings.factoryResetting') : t('dataSettings.factoryReset')}
                  </button>
                </div>
              </div>
            </div>
          )}
          {settingsTab === 'appearance' && (
            <div className="settings-section">
              <h3>{t('appearanceSettings.title')}</h3>
              <p className="settings-desc">{t('appearanceSettings.desc')}</p>

              <label>{t('appearanceSettings.theme')}</label>
              <div className="theme-options">
                {[
                  { value: 'light', label: t('appearanceSettings.light'), icon: (
                    <Sun width={20} height={20} />
                  )},
                  { value: 'dark', label: t('appearanceSettings.dark'), icon: (
                    <Moon width={20} height={20} />
                  )},
                  { value: 'system', label: t('appearanceSettings.system'), icon: (
                    <Monitor width={20} height={20} />
                  )},
                ].map((opt) => (
                  <button
                    key={opt.value}
                    className={`theme-option ${theme === opt.value ? 'active' : ''}`}
                    onClick={() => onThemeChange(opt.value)}
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {settingsTab === 'language' && (
            <div className="settings-section">
              <h3>{t('languageSettings.title')}</h3>
              <p className="settings-desc">{t('languageSettings.desc')}</p>

              <label>{t('languageSettings.label')}</label>
              <div className="theme-options">
                {SUPPORTED_LOCALES.map((loc) => (
                  <button
                    key={loc.id}
                    className={`theme-option ${localePref === loc.id ? 'active' : ''}`}
                    onClick={() => changeLocale(loc.id)}
                  >
                    <span>{loc.id === 'auto' ? t('languageSettings.auto') : loc.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {settingsTab === 'skills' && (
            <div className="settings-section">
              <h3>{t('skillSettings.title')}</h3>
              <p className="settings-desc">{t('skillSettings.desc')}</p>

              {skillsLoading && (
                <div className="skills-loading">{t('filemanage.loading')}</div>
              )}

              {!skillsLoading && skillsList.length === 0 && (
                <div className="agents-empty">{t('skillSettings.empty')}</div>
              )}

              {!skillsLoading && skillsList.length > 0 && (
                <>
                  <div className="skills-bulk-actions">
                    <button
                      className="skills-bulk-btn"
                      onClick={() => handleBulkToggle(true)}
                    >
                      {t('skillSettings.enableAll')}
                    </button>
                    <button
                      className="skills-bulk-btn"
                      onClick={() => handleBulkToggle(false)}
                    >
                      {t('skillSettings.disableAll')}
                    </button>
                  </div>

                  <div className="skills-list">
                    {skillsList.map((skill) => (
                      <div key={skill.name} className={`skill-item ${skill.enabled ? 'enabled' : 'disabled'}`}>
                        <div className="skill-info">
                          <div className="skill-name">{skill.name}</div>
                          <div className="skill-desc">{skill.description}</div>
                          <div className="skill-version">{t('skillSettings.version')}: {skill.version}</div>
                        </div>
                        <label className="skill-toggle">
                          <input
                            type="checkbox"
                            checked={skill.enabled}
                            onChange={(e) => handleSkillToggle(skill.name, e.target.checked)}
                          />
                          <span className="skill-toggle-slider"></span>
                        </label>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;