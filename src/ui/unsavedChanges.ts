import { createContext, useContext } from 'react';

/**
 * Lets a form flag unsaved changes so navigation can ask before discarding
 * them. Kept in a ref by the provider, so flagging never causes re-renders.
 */
export interface UnsavedChangesValue {
  setDirty(dirty: boolean): void;
  /** True when leaving is fine: nothing unsaved, or the user agreed to discard. */
  confirmLeave(): boolean;
}

export const UnsavedChangesContext = createContext<UnsavedChangesValue | null>(null);

export function useUnsavedChanges(): UnsavedChangesValue {
  const value = useContext(UnsavedChangesContext);
  if (!value) throw new Error('useUnsavedChanges must be used inside <UnsavedChangesProvider>');
  return value;
}
