import type { ReactNode } from 'react';
import AuthProvider from './AuthProvider';
import type { CloudSetup } from './cloudSetup';
import SyncProvider from './SyncProvider';

interface CloudProviderProps {
  cloud: CloudSetup;
  storage?: Storage | null;
  children: ReactNode;
}

/** Accounts and sync, for everything inside it. */
export default function CloudProvider({ cloud, storage, children }: CloudProviderProps) {
  return (
    <AuthProvider services={cloud.services} configError={cloud.error}>
      <SyncProvider storage={storage}>{children}</SyncProvider>
    </AuthProvider>
  );
}
