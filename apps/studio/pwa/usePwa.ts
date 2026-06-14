import { useEffect, useState } from 'react';
import {
  applyPwaUpdate,
  checkForPwaUpdate,
  getPwaSnapshot,
  registerPwa,
  requestPwaInstall,
  subscribeToPwa,
} from './pwaLifecycle';

export function usePwa() {
  const [snapshot, setSnapshot] = useState(getPwaSnapshot);

  useEffect(() => {
    registerPwa();
    return subscribeToPwa(setSnapshot);
  }, []);

  return {
    snapshot,
    install: requestPwaInstall,
    checkForUpdate: checkForPwaUpdate,
    applyUpdate: applyPwaUpdate,
  };
}
