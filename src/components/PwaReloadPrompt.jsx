import { useRegisterSW } from 'virtual:pwa-register/react';
import { useState, useEffect } from 'react';

export default function PwaReloadPrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('[PWA] Service Worker registered:', r);
    },
    onRegisterError(error) {
      console.warn('[PWA] Service Worker registration failed:', error);
    },
  });

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (offlineReady || needRefresh) {
      setVisible(true);
    }
  }, [offlineReady, needRefresh]);

  if (!visible) return null;

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
    setVisible(false);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between gap-3 rounded-xl bg-indigo-600 px-5 py-3 text-white shadow-lg sm:left-auto sm:right-4 sm:w-auto">
      <p className="text-sm">
        {needRefresh
          ? 'New version available'
          : 'App ready to work offline'}
      </p>
      <div className="flex gap-2">
        {needRefresh && (
          <button
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
            onClick={() => updateServiceWorker(true)}
          >
            Update
          </button>
        )}
        <button
          className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400"
          onClick={close}
        >
          Close
        </button>
      </div>
    </div>
  );
}
