import { useState, useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/context';
import { Plus, X, Menu, ChevronLeft, ChevronRight } from '../Icons/Icons';
import './ChatList.css';

// Breakpoint for mobile/tablet
const MOBILE_BREAKPOINT = 768;

const ChatList = ({ chats, activeChatId, onSelectChat, onNewChat, onDeleteChat, collapsed = false, onToggleCollapse, chatAgents = {}, agentList = [] }) => {
  const { t } = useI18n();
  const [width, setWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const panelRef = useRef(null);

  // Check screen size
  useEffect(() => {
    const checkScreen = () => {
      const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (!mobile) {
        setMobileOpen(false);
      }
    };
    checkScreen();
    window.addEventListener('resize', checkScreen);
    return () => window.removeEventListener('resize', checkScreen);
  }, []);

  // Close mobile panel on chat select
  const handleSelectChat = useCallback((chatId) => {
    onSelectChat(chatId);
    if (isMobile) {
      setMobileOpen(false);
    }
  }, [onSelectChat, isMobile]);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    if (newWidth >= 200 && newWidth <= 600) {
      setWidth(newWidth);
    }
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Close panel when clicking outside on mobile
  useEffect(() => {
    if (!isMobile || !mobileOpen) return;

    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setMobileOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMobile, mobileOpen]);

  // Global mouse event listeners for resizing
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Toggle mobile panel
  const toggleMobile = useCallback(() => {
    setMobileOpen(prev => !prev);
  }, []);

  // Toggle collapse (PC mode only)
  const handleToggleCollapse = useCallback(() => {
    if (!isMobile && onToggleCollapse) {
      onToggleCollapse();
    }
  }, [isMobile, onToggleCollapse]);

  return (
    <>
      {/* Toggle button - visible only on mobile */}
      <button
        className={`chat-list-toggle-btn ${mobileOpen ? 'open' : ''}`}
        onClick={toggleMobile}
        aria-label="Toggle chat list"
      >
        <Menu width={20} height={20} />
      </button>

      {/* Backdrop */}
      {isMobile && mobileOpen && (
        <div className="chat-list-backdrop show" onClick={() => setMobileOpen(false)} />
      )}

      {/* Chat list panel */}
      <div
        ref={panelRef}
        className={`chat-list ${isMobile && mobileOpen ? 'mobile-open' : ''} ${!isMobile && collapsed ? 'collapsed' : ''}`}
        style={!isMobile ? { width: collapsed ? 0 : width, minWidth: collapsed ? 0 : width } : {}}
      >
        <div className="chat-list-inner">
          <div className="chat-list-header">
            <h2>{t('app.name')}</h2>
            <button className="new-chat-btn" onClick={onNewChat} title={t('chat.newChat')}>
              <Plus width={20} height={20} />
            </button>
          </div>
          <div className="chat-list-items">
            {chats.map((chat) => (
              <div
                key={chat.id}
                className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`}
                onClick={() => handleSelectChat(chat.id)}
              >
                <div className="chat-item-row">
                  <div className="chat-item-title">
                    {chat.title}
                    {chatAgents[chat.id] && (
                      <span className="chat-agent-badge">
                        {(() => {
                          const agent = agentList.find((a) => a.id === chatAgents[chat.id]);
                          return agent ? agent.name : chatAgents[chat.id];
                        })()}
                      </span>
                    )}
                  </div>
                  <button
                    className="chat-item-delete"
                    title={t('chat.deleteChat')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(chat.id);
                    }}
                  >
                    <X width={14} height={14} />
                  </button>
                </div>
                <div className="chat-item-preview">{chat.lastMessage || t('chat.noMessages')}</div>
                <div className="chat-item-time">{chat.updatedAt}</div>
              </div>
            ))}
            {chats.length === 0 && (
              <div className="chat-list-empty">
                <p>{t('chat.noConversations')}</p>
                <p>{t('chat.clickToStart')}</p>
              </div>
            )}
          </div>
          {!isMobile && !collapsed && (
            <div
              className={`chat-list-resize-handle ${isResizing ? 'resizing' : ''}`}
              onMouseDown={handleMouseDown}
            />
          )}
        </div>
        {/* Collapse toggle button - PC mode only, positioned on right border (hidden when collapsed) */}
        {!isMobile && !collapsed && (
          <button
            className="chat-list-collapse-btn"
            onClick={handleToggleCollapse}
            aria-label="Collapse chat list"
            title="Collapse"
          >
            <ChevronLeft width={14} height={14} />
          </button>
        )}
      </div>
    </>
  );
};

export default ChatList;
