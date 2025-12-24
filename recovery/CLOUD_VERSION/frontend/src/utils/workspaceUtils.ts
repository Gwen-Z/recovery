const QUICK_NOTE_STORAGE_KEY = 'quick-note-draft';

const escapeHtml = (input: string) =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const textToHtml = (text: string) => {
  const lines = (text || '').split('\n');
  const html = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  return html || '<p><br/></p>';
};

export function saveQuickNoteDraft(plainText: string) {
  if (typeof window === 'undefined') return;
  try {
    const payload = {
      html: textToHtml(plainText),
      plainText,
      createdAt: Date.now()
    };
    window.sessionStorage.setItem(QUICK_NOTE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function computeAvoidOffset(
  bubblePx: { x: number; y: number },
  cardCenterPx: { x: number; y: number },
  strength: number
) {
  const dx = bubblePx.x - cardCenterPx.x;
  const dy = bubblePx.y - cardCenterPx.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: (dx / len) * strength, y: (dy / len) * strength };
}

