import { useState, useCallback, useEffect } from 'react';
import { useI18n } from '../../i18n/context';
import { Plus, X } from '../Icons/Icons';
import './ChatList.css';

const ChatList = ({ chats, activeChatId, onSelectChat, onNewChat, onDeleteChat }) => {
  const { t } = useI18n();
  const [width, setWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);

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

  // Global mouse event listeners for resizing
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div className="chat-list" style={{ width, minWidth: width }}>
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
            onClick={() => onSelectChat(chat.id)}
          >
            <div className="chat-item-row">
              <div className="chat-item-title">{chat.title}</div>
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
      <div
        className={`chat-list-resize-handle ${isResizing ? 'resizing' : ''}`}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};

export default ChatList;