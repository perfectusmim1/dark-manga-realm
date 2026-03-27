export const isDocumentVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible';
