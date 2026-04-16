import { useState, useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/context';
import { loadFiles, saveFile, createFile, createDirectory, deleteFile as deleteLocalFile, getFileBlob } from '../../vfs/opfs';
import { listRemoteFiles, createRemoteFile, deleteRemoteFile, uploadRemoteFile, downloadRemoteFile } from '../../models/agent';
import { ChevronRight, Folder, File, FilePlus, FolderPlus, Refresh, X, Upload, Cloud, HardDrive, Trash, Download } from '../Icons/Icons';
import './FileManage.css';

const FileManage = ({ show, onClose, refreshTrigger, width, onWidthChange }) => {
  const { t } = useI18n();
  const [fileSource, setFileSource] = useState('local'); // 'local' or 'remote'
  const [fileTree, setFileTree] = useState(null);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const expandedDirsRef = useRef(new Set());
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  // Load files when shown, source changes, or refreshTrigger changes
  useEffect(() => {
    if (show) {
      setLoading(true);
      setError(null);
      
      const loadFn = fileSource === 'local' ? loadFiles : () => listRemoteFiles('', window.location.origin);
      
      loadFn()
        .then((rootDir) => {
          setFileTree({
            ...rootDir,
            expanded: true,
          });
          setExpandedDirs(new Set(['root']));
        })
        .catch((err) => {
          console.warn('Failed to load files:', err);
          setError(fileSource === 'local' ? t('filemanage.loadLocalError') : t('filemanage.loadRemoteError'));
          setFileTree({
            id: 'root',
            name: '/',
            type: 'directory',
            expanded: true,
            children: [],
          });
          setExpandedDirs(new Set(['root']));
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [show, refreshTrigger, fileSource, t]);

  // Keep ref in sync with state
  useEffect(() => {
    expandedDirsRef.current = expandedDirs;
  }, [expandedDirs]);

  // Handle file upload via input (local)
  const handleLocalFileUpload = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    
    setUploading(true);
    const fileArray = Array.from(files);
    
    try {
      for (const file of fileArray) {
        await saveFile(file.name, file);
      }
      const rootDir = await loadFiles();
      setFileTree({
        ...rootDir,
        expanded: true,
      });
    } catch (err) {
      console.warn('Failed to upload file:', err);
    } finally {
      setUploading(false);
    }
  }, []);

  // Handle file upload to remote
  const handleRemoteFileUpload = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    
    setUploading(true);
    const fileArray = Array.from(files);
    
    try {
      for (const file of fileArray) {
        await uploadRemoteFile(file.name, file, window.location.origin);
      }
      const rootDir = await listRemoteFiles('', window.location.origin);
      setFileTree({
        ...rootDir,
        expanded: true,
      });
    } catch (err) {
      console.warn('Failed to upload remote file:', err);
      alert(t('filemanage.uploadRemoteError'));
    } finally {
      setUploading(false);
    }
  }, [t]);

  const handleFileUpload = useCallback((files) => {
    if (fileSource === 'local') {
      handleLocalFileUpload(files);
    } else {
      handleRemoteFileUpload(files);
    }
  }, [fileSource, handleLocalFileUpload, handleRemoteFileUpload]);

  const handleFileInputChange = useCallback((e) => {
    handleFileUpload(e.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFileUpload, fileSource]);

  // Handle drag and drop
  useEffect(() => {
    const dropZone = dropZoneRef.current;
    if (!dropZone || !show) return;

    const handleDragOver = (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    };

    const handleDrop = (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleFileUpload(e.dataTransfer.files);
    };

    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleDrop);

    return () => {
      dropZone.removeEventListener('dragover', handleDragOver);
      dropZone.removeEventListener('dragleave', handleDragLeave);
      dropZone.removeEventListener('drop', handleDrop);
    };
  }, [show, handleFileUpload, fileSource]);

  // Resize handlers
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isResizing) return;
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth >= 200 && newWidth <= 600) {
      onWidthChange?.(newWidth);
    }
  }, [isResizing, onWidthChange]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Toggle directory expansion
  const toggleDirectory = useCallback(async (dirId, dirName, parentDir = '') => {
    // Check current expansion state using ref to avoid stale closure
    const isCurrentlyExpanded = expandedDirsRef.current.has(dirId);
    
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      
      if (isCurrentlyExpanded) {
        // Collapse: remove from set
        next.delete(dirId);
      } else {
        // Expand: add to set
        next.add(dirId);
      }
      
      // Update ref synchronously
      expandedDirsRef.current = new Set(next);
      
      return next;
    });

    // Load directory content if expanding (only for remote files)
    if (!isCurrentlyExpanded && fileSource === 'remote' && dirName && dirName !== '/') {
      try {
        const path = parentDir ? `${parentDir}/${dirName}` : dirName;
        const children = await listRemoteFiles(path, window.location.origin);
        setFileTree((prevTree) => {
          const updateNode = (node) => {
            if (node.id === dirId) {
              return { ...node, children };
            }
            if (node.children) {
              return { ...node, children: node.children.map(updateNode) };
            }
            return node;
          };
          return updateNode(prevTree);
        });
      } catch (err) {
        console.warn(`Failed to load directory ${dirName}:`, err);
      }
    }
  }, [fileSource]);

  const handleNewFile = useCallback(async () => {
    const fileName = prompt(t('filemanage.newFileNamePrompt'), 'untitled.txt');
    if (!fileName) return;
    
    try {
      if (fileSource === 'local') {
        await createFile(fileName, undefined);
        const rootDir = await loadFiles();
        setFileTree({
          ...rootDir,
          expanded: true,
        });
      } else {
        // Remote file creation
        await createRemoteFile(fileName, '', false, window.location.origin);
        const rootDir = await listRemoteFiles('', window.location.origin);
        setFileTree({
          ...rootDir,
          expanded: true,
        });
      }
    } catch (err) {
      console.warn('Failed to create file:', err);
      alert(t('filemanage.createFileError'));
    }
  }, [t, fileSource]);

  const handleNewDir = useCallback(async () => {
    const newDirName = prompt(t('filemanage.newDirNamePrompt'), 'new-folder');
    if (!newDirName) return;
    
    try {
      if (fileSource === 'local') {
        await createDirectory(newDirName, undefined);
        const rootDir = await loadFiles();
        setFileTree({
          ...rootDir,
          expanded: true,
        });
      } else {
        // Remote directory creation
        await createRemoteFile(newDirName, '', true, window.location.origin);
        const rootDir = await listRemoteFiles('', window.location.origin);
        setFileTree({
          ...rootDir,
          expanded: true,
        });
      }
    } catch (err) {
      console.warn('Failed to create directory:', err);
      alert(t('filemanage.createDirError'));
    }
  }, [t, fileSource]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const loadFn = fileSource === 'local' ? loadFiles : () => listRemoteFiles('', window.location.origin);
      const rootDir = await loadFn();
      setFileTree({
        ...rootDir,
        expanded: true,
      });
      setExpandedDirs(new Set(['root']));
    } catch (err) {
      console.warn('Failed to refresh:', err);
      setError(fileSource === 'local' ? t('filemanage.loadLocalError') : t('filemanage.loadRemoteError'));
    } finally {
      setLoading(false);
    }
  }, [fileSource, t]);

  const handleSourceChange = useCallback((newSource) => {
    setFileSource(newSource);
  }, []);

  // Delete file handler
  const handleDeleteFile = useCallback(async (fileName, filePath, isDirectory) => {
    const confirmMsg = isDirectory 
      ? t('filemanage.confirmDeleteDir').replace('{name}', fileName)
      : t('filemanage.confirmDeleteFile').replace('{name}', fileName);
    
    if (!window.confirm(confirmMsg)) return;
    
    try {
      if (fileSource === 'local') {
        await deleteLocalFile(fileName, filePath || 'files');
        const rootDir = await loadFiles();
        setFileTree({
          ...rootDir,
          expanded: true,
        });
      } else {
        // Remote delete
        const path = filePath ? `${filePath}/${fileName}` : fileName;
        await deleteRemoteFile(path, window.location.origin);
        const rootDir = await listRemoteFiles('', window.location.origin);
        setFileTree({
          ...rootDir,
          expanded: true,
        });
      }
    } catch (err) {
      console.warn('Failed to delete file:', err);
      alert(t('filemanage.deleteFileError'));
    }
  }, [t, fileSource]);

  // Download file handler
  const handleDownloadFile = useCallback(async (fileName, filePath) => {
    try {
      if (fileSource === 'local') {
        // Download local file
        const blob = await getFileBlob(fileName, filePath || 'files');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // Download remote file
        const path = filePath ? `${filePath}/${fileName}` : fileName;
        const blob = await downloadRemoteFile(path, window.location.origin);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.warn('Failed to download file:', err);
      alert(t('filemanage.downloadFileError'));
    }
  }, [t, fileSource]);

  const renderTreeNode = (node, depth = 0, parentDir = '') => {
    if (node.type === 'directory') {
      const isExpanded = expandedDirs.has(node.id);
      return (
        <div key={node.id} className="tree-node directory-node" style={{ paddingLeft: depth * 16 }}>
          <div
            className="tree-item"
            onClick={(e) => {
              e.stopPropagation();
              toggleDirectory(node.id, node.name, parentDir || node.parentDir);
            }}
          >
            <ChevronRight
              className="tree-chevron"
              width={12}
              height={12}
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            />
            <Folder className="tree-icon folder-icon" width={18} height={18} />
            <span className="tree-label">{node.name}</span>
            {isExpanded && node.children && node.children.length > 0 && (
              <span className="tree-count">({node.children.length})</span>
            )}
          </div>
          {isExpanded && node.children && (
            <div className="tree-children">
              {node.children.map((child) => renderTreeNode(child, depth + 1, node.path || parentDir))}
            </div>
          )}
        </div>
      );
    } else {
      return (
        <div key={node.id} className="tree-node file-node" style={{ paddingLeft: depth * 16 + 12 }}>
          <div className="tree-item file-item">
            <span className="tree-icon-spacer" />
            <File className="tree-icon file-icon" width={18} height={18} />
            <span className="tree-label">{node.name}</span>
            {node.size && <span className="tree-size">{formatFileSize(node.size)}</span>}
            <div className="file-actions">
              <button
                className="file-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownloadFile(node.name, node.parentDir);
                }}
                title={t('filemanage.download')}
              >
                <Download width={16} height={16} />
              </button>
              <button
                className="file-action-btn delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteFile(node.name, node.parentDir, false);
                }}
                title={t('filemanage.delete')}
              >
                <Trash width={16} height={16} />
              </button>
            </div>
          </div>
        </div>
      );
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (!show) return null;

  return (
    <div
      className={`filemanage-panel ${show ? 'show' : ''}`}
      style={{ '--panel-width': `${width}px` }}
    >
      {/* Header */}
      <div className="filemanage-header">
        <div className="filemanage-header-left">
          {/* Source Selector */}
          <div className="filemanage-source-selector">
            <button
              className={`source-btn ${fileSource === 'local' ? 'active' : ''}`}
              onClick={() => handleSourceChange('local')}
              title={t('filemanage.localFiles')}
            >
              <HardDrive width={16} height={16} />
              <span>{t('filemanage.localFiles')}</span>
            </button>
            <button
              className={`source-btn ${fileSource === 'remote' ? 'active' : ''}`}
              onClick={() => handleSourceChange('remote')}
              title={t('filemanage.remoteFiles')}
            >
              <Cloud width={16} height={16} />
              <span>{t('filemanage.remoteFiles')}</span>
            </button>
          </div>
        </div>
        <div className="filemanage-header-buttons">
          <button className="filemanage-header-btn" onClick={handleNewFile} title={t('filemanage.newFile')}>
            <FilePlus width={18} height={18} />
          </button>
          <button className="filemanage-header-btn" onClick={handleNewDir} title={t('filemanage.newDir')}>
            <FolderPlus width={18} height={18} />
          </button>
          <button className="filemanage-header-btn" onClick={handleRefresh} title={t('filemanage.refresh')}>
            <Refresh width={18} height={18} />
          </button>
          <button className="filemanage-close-btn" onClick={onClose}>
            <X width={18} height={18} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="filemanage-content" ref={dropZoneRef}>
        {/* File Tree */}
        <div className="filemanage-tree">
          {loading ? (
            <div className="filemanage-empty">
              <Folder width={48} height={48} />
              <p>{t('filemanage.loading')}</p>
            </div>
          ) : error ? (
            <div className="filemanage-empty">
              <Folder width={48} height={48} />
              <p className="filemanage-error">{error}</p>
            </div>
          ) : fileTree && fileTree.children?.length === 0 ? (
            <div className="filemanage-empty">
              <Folder width={48} height={48} />
              <p>{fileSource === 'local' ? t('filemanage.empty') : t('filemanage.remoteEmpty')}</p>
            </div>
          ) : (
            fileTree && renderTreeNode(fileTree)
          )}
        </div>

        {/* Upload Zone - only show for local files */}
        {fileSource === 'local' && (
          <div className="filemanage-upload-zone">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />
            <button
              className="filemanage-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload width={20} height={20} />
              {uploading ? t('filemanage.uploading') : t('filemanage.upload')}
            </button>
            <span className="filemanage-drop-hint">{t('filemanage.dropHint')}</span>
          </div>
        )}
        
        {fileSource === 'remote' && (
          <div className="filemanage-upload-zone">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />
            <button
              className="filemanage-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload width={20} height={20} />
              {uploading ? t('filemanage.uploading') : t('filemanage.upload')}
            </button>
            <span className="filemanage-drop-hint">{t('filemanage.dropHint')}</span>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div
        className={`filemanage-resize-handle ${isResizing ? 'resizing' : ''}`}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};

export default FileManage;