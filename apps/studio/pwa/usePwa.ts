import { useEffect, useState } from 'react';
import {
  applyPwaUpdate,
  checkForPwaUpdate,
  downloadPwaAssetGroup,
  snapshot as initialPwaSnapshot,
  registerPwa,
  removePwaAssetGroup,
  requestPwaInstall,
  refreshPwaCacheStatus,
  subscribeToPwa,
} from './pwaLifecycle';

export function usePwa() {
  const [snapshot, setSnapshot] = useState(initialPwaSnapshot);

  useEffect(() => {
    registerPwa();
    return subscribeToPwa(setSnapshot);
  }, []);

  return {
    snapshot,
    install: requestPwaInstall,
    checkForUpdate: checkForPwaUpdate,
    applyUpdate: applyPwaUpdate,
    refreshCacheStatus: refreshPwaCacheStatus,
    downloadAssetGroup: downloadPwaAssetGroup,
    removeAssetGroup: removePwaAssetGroup,
  };
}
