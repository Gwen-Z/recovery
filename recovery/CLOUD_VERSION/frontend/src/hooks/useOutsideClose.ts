import { useEffect } from 'react';

export function useOutsideClose(
  open: boolean,
  rootSelector: string,
  onClose: () => void
) {
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(rootSelector)) return;
      onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open, rootSelector, onClose]);
}

