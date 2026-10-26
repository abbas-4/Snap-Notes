import { useMemo, useRef, type ReactNode } from 'react';
import { UnsavedChangesContext, type UnsavedChangesValue } from './unsavedChanges';

export default function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtyRef = useRef(false);

  const value = useMemo<UnsavedChangesValue>(
    () => ({
      setDirty(dirty: boolean) {
        dirtyRef.current = dirty;
      },
      confirmLeave() {
        if (!dirtyRef.current) return true;
        const leave = window.confirm('You have unsaved changes. Discard them?');
        if (leave) dirtyRef.current = false;
        return leave;
      },
    }),
    [],
  );

  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>;
}
