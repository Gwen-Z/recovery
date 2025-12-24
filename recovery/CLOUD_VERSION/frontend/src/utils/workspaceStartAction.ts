export type WorkspaceStartActionV1 = {
  v: 1;
  source: 'landing';
  mode: 'link' | 'text';
  inputValue: string;
  activeSceneId: string | null;
  createdAt: number;
};

const STORAGE_KEY = 'workspace.start-action.v1';
const MAX_AGE_MS = 5 * 60 * 1000;

export function setWorkspaceStartAction(action: Omit<WorkspaceStartActionV1, 'v' | 'createdAt'>) {
  if (typeof window === 'undefined') return;
  try {
    const payload: WorkspaceStartActionV1 = {
      v: 1,
      createdAt: Date.now(),
      ...action
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function consumeWorkspaceStartAction(): WorkspaceStartActionV1 | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== 1) return null;
    if (parsed.source !== 'landing') return null;
    if (parsed.mode !== 'link' && parsed.mode !== 'text') return null;
    if (typeof parsed.inputValue !== 'string') return null;
    const createdAt = Number(parsed.createdAt);
    if (!Number.isFinite(createdAt)) return null;
    if (Date.now() - createdAt > MAX_AGE_MS) return null;
    return {
      v: 1,
      source: 'landing',
      mode: parsed.mode,
      inputValue: parsed.inputValue,
      activeSceneId: typeof parsed.activeSceneId === 'string' ? parsed.activeSceneId : null,
      createdAt
    };
  } catch {
    return null;
  }
}

