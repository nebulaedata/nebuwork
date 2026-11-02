import { useEffect, useRef, useState } from 'react';
import { authSession } from '../../services/authSession.js';

export function useDatabaseLife(key) {
  const [epoch, setEpoch] = useState(authSession.getSnapshot().version), current = useRef(null);
  useEffect(() => {
    const controller = new AbortController(), version = authSession.getSnapshot().version;
    current.current = { controller, version, key };
    const unsubscribe = authSession.subscribe(() => { const next = authSession.getSnapshot().version; if (next !== version) { controller.abort(); setEpoch(next); } });
    return () => { controller.abort(); unsubscribe(); };
  }, [key, epoch]);
  const matching = () => current.current?.key === key && current.current.version === epoch;
  return { epoch, live: () => matching() && !current.current.controller.signal.aborted && current.current.version === authSession.getSnapshot().version, signal: () => matching() ? current.current.controller.signal : AbortSignal.abort() };
}
