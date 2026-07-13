import { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { listFiles } from '../services/dataStore';
import { getToken } from '../services/auth';

const AppContext = createContext();

const initialState = {
  fileHistory: [],
  vocabulary: [],
  translationCount: 0,
  ttsCount: 0,
  uploadState: null, // { id, name, stage, pct, done, total, error }
};

function loadState() {
  try {
    const saved = localStorage.getItem('lexilearn_state');
    if (saved) {
      return { ...initialState, ...JSON.parse(saved) };
    }
  } catch {
    // ignore parse errors
  }
  return initialState;
}

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_FILE': {
      const exists = state.fileHistory.find((f) => f.id === action.payload.id);
      if (exists) {
        return {
          ...state,
          fileHistory: state.fileHistory.map((f) =>
            f.id === action.payload.id ? { ...f, ...action.payload, openedAt: Date.now() } : f
          ),
        };
      }
      return {
        ...state,
        fileHistory: [
          { ...action.payload, openedAt: Date.now() },
          ...state.fileHistory,
        ].slice(0, 50),
      };
    }
    case 'ADD_WORD': {
      const word = action.payload.toLowerCase();
      const exists = state.vocabulary.find((w) => w.word === word);
      if (exists) {
        return {
          ...state,
          vocabulary: state.vocabulary.map((w) =>
            w.word === word ? { ...w, addedAt: Date.now(), count: w.count + 1 } : w
          ),
        };
      }
      return {
        ...state,
        vocabulary: [{ word, addedAt: Date.now(), count: 1 }, ...state.vocabulary],
      };
    }
    case 'REMOVE_WORD':
      return {
        ...state,
        vocabulary: state.vocabulary.filter((w) => w.word !== action.payload.toLowerCase()),
      };
    case 'CLEAR_VOCABULARY':
      return { ...state, vocabulary: [] };
    case 'INCREMENT_TRANSLATION':
      return { ...state, translationCount: state.translationCount + 1 };
    case 'INCREMENT_TTS':
      return { ...state, ttsCount: state.ttsCount + 1 };
    case 'DELETE_FILE':
      return {
        ...state,
        fileHistory: state.fileHistory.filter((f) => f.id !== action.payload),
      };
    case 'SET_FILES':
      return {
        ...state,
        fileHistory: action.payload.map((serverFile) => {
          const localFile = state.fileHistory.find((f) => f.id === serverFile.id);
          if (localFile) {
            return { ...serverFile, text: localFile.text, pages: localFile.pages, openedAt: localFile.openedAt, readingProgress: localFile.readingProgress || serverFile.readingProgress };
          }
          return serverFile;
        }),
      };
    case 'UPDATE_FILE_PROGRESS':
      return {
        ...state,
        fileHistory: state.fileHistory.map((f) =>
          f.id === action.payload.id
            ? { ...f, readingProgress: action.payload.progress }
            : f
        ),
      };
    case 'RENAME_FILE':
      return {
        ...state,
        fileHistory: state.fileHistory.map((f) =>
          f.id === action.payload.id
            ? { ...f, name: action.payload.name }
            : f
        ),
      };
    case 'UPLOAD_START':
      return {
        ...state,
        uploadState: action.payload,
      };
    case 'UPLOAD_PROGRESS':
      return {
        ...state,
        uploadState: { ...state.uploadState, ...action.payload },
      };
    case 'UPLOAD_DONE':
      return {
        ...state,
        uploadState: null,
      };
    case 'RESET_STATE':
      return initialState;
    default:
      return state;
  }
}

// ── 服务端同步（去抖） ──

let vocabSyncTimer = null;
function scheduleVocabSync(vocabulary) {
  if (vocabSyncTimer) clearTimeout(vocabSyncTimer);
  vocabSyncTimer = setTimeout(async () => {
    const t = getToken();
    if (!t) return;
    try {
      await fetch('/api/vocabulary/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({ vocabulary }),
      });
    } catch { /* 静默失败 — 本地数据始终是权威来源 */ }
  }, 5000);
}

let statsAccumulator = { translation: 0, tts: 0 };
let statsSyncTimer = null;
function scheduleStatsSync(type) {
  statsAccumulator[type] = (statsAccumulator[type] || 0) + 1;
  if (statsSyncTimer) clearTimeout(statsSyncTimer);
  statsSyncTimer = setTimeout(async () => {
    const t = getToken();
    const pending = { ...statsAccumulator };
    statsAccumulator = { translation: 0, tts: 0 };
    if (!t) return;
    for (const [kind, count] of Object.entries(pending)) {
      for (let i = 0; i < count; i++) {
        try {
          await fetch('/api/stats/record', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${t}`,
            },
            body: JSON.stringify({ type: kind }),
          });
        } catch { break; }
      }
    }
  }, 3000);
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, loadState);
  const fileBuffersRef = useRef(new Map());

  // 持久化到 localStorage
  useEffect(() => {
    const { uploadState, ...persistable } = state;
    localStorage.setItem('lexilearn_state', JSON.stringify(persistable));
  }, [state]);

  // 生词本变更时同步到服务端
  useEffect(() => {
    scheduleVocabSync(state.vocabulary);
  }, [state.vocabulary]);

  const addFile = useCallback((file) => dispatch({ type: 'ADD_FILE', payload: file }), []);
  const addFileBuffer = useCallback((id, buffer) => {
    fileBuffersRef.current.set(id, buffer);
  }, []);
  const getFileBuffer = useCallback((id) => {
    return fileBuffersRef.current.get(id) || null;
  }, []);

  const addToVocabulary = useCallback((word) => dispatch({ type: 'ADD_WORD', payload: word }), []);
  const removeFromVocabulary = useCallback((word) => dispatch({ type: 'REMOVE_WORD', payload: word }), []);
  const clearVocabulary = useCallback(() => dispatch({ type: 'CLEAR_VOCABULARY' }), []);

  const recordTranslation = useCallback(() => {
    dispatch({ type: 'INCREMENT_TRANSLATION' });
    scheduleStatsSync('translation');
  }, []);
  const recordTTS = useCallback(() => {
    dispatch({ type: 'INCREMENT_TTS' });
    scheduleStatsSync('tts');
  }, []);

  const deleteFile = useCallback((id) => {
    fileBuffersRef.current.delete(id);
    dispatch({ type: 'DELETE_FILE', payload: id });
  }, []);

  const syncFiles = useCallback(async () => {
    try {
      const serverFiles = await listFiles();
      dispatch({ type: 'SET_FILES', payload: serverFiles });
    } catch {
      // 网络错误时保留本地数据
    }
  }, []);

  const resetAppState = useCallback(() => {
    localStorage.removeItem('lexilearn_state');
    fileBuffersRef.current.clear();
    dispatch({ type: 'RESET_STATE' });
  }, []);

  const updateFileProgress = useCallback((id, progress) => {
    dispatch({ type: 'UPDATE_FILE_PROGRESS', payload: { id, progress } });
  }, []);

  const renameFile = useCallback((id, name) => {
    dispatch({ type: 'RENAME_FILE', payload: { id, name } });
  }, []);

  const startUpload = useCallback((payload) => dispatch({ type: 'UPLOAD_START', payload }), []);
  const updateUploadProgress = useCallback((payload) => dispatch({ type: 'UPLOAD_PROGRESS', payload }), []);
  const finishUpload = useCallback(() => dispatch({ type: 'UPLOAD_DONE' }), []);

  return (
    <AppContext.Provider
      value={{
        state,
        addFile,
        addFileBuffer,
        getFileBuffer,
        addToVocabulary,
        removeFromVocabulary,
        clearVocabulary,
        recordTranslation,
        recordTTS,
        deleteFile,
        syncFiles,
        resetAppState,
        updateFileProgress,
        renameFile,
        startUpload,
        updateUploadProgress,
        finishUpload,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
