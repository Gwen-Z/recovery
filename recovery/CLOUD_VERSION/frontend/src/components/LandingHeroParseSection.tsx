import React, {
  useState,
  useMemo,
  useLayoutEffect,
  useRef,
  useEffect,
  useCallback
} from 'react';
import { useNavigate } from 'react-router-dom';
import { ArticleIcon, BookExcerptIcon, InspirationNoteIcon, MeetingNoteIcon, TodoIcon } from './WorkspaceSceneIcons';
import { useAuth } from '../auth/AuthContext';
import { setWorkspaceStartAction } from '../utils/workspaceStartAction';

type InputMode = 'link' | 'text';

type SceneBubble = {
  id: string;
  label: string;
  icon: React.ReactNode;
  mode: InputMode;
  placeholder?: string;
  anchor: { x: number; y: number };
  size?: 'sm' | 'md';
};

const SCENE_BUBBLES: SceneBubble[] = [
  {
    id: 'meeting',
    label: '会议记录',
    icon: <MeetingNoteIcon className="h-4 w-4" />,
    mode: 'text',
    placeholder: '简单记录这次会议的要点、结论和待办…',
    anchor: { x: 0.22, y: 0.28 },
    size: 'md'
  },
  {
    id: 'thinking',
    label: '思考卡片',
    icon: <InspirationNoteIcon className="h-4 w-4" />,
    mode: 'text',
    placeholder: '写下一段想法或灵感，AI 会帮你整理成可复用的思考卡片…',
    anchor: { x: 0.6, y: 0.22 },
    size: 'md'
  },
  {
    id: 'reading',
    label: '读书摘录',
    icon: <BookExcerptIcon className="h-4 w-4" />,
    mode: 'text',
    placeholder: '粘贴一段你正在阅读的内容，AI 会帮你提炼要点…',
    anchor: { x: 0.8, y: 0.32 },
    size: 'sm'
  },
  {
    id: 'weixin-article',
    label: '公众号长文',
    icon: <ArticleIcon className="h-4 w-4" />,
    mode: 'link',
    placeholder: '粘贴公众号/知乎等文章链接，交给 AI 帮你拆解…',
    anchor: { x: 0.24, y: 0.7 },
    size: 'sm'
  },
  {
    id: 'todo',
    label: '待办清单',
    icon: <TodoIcon className="h-4 w-4" />,
    mode: 'text',
    placeholder: '把杂乱的待办和想法丢进来，AI 会帮你整理成清单…',
    anchor: { x: 0.78, y: 0.72 },
    size: 'md'
  }
];

const LinkParseIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path
      d="M607.934444 417.856853c-6.179746-6.1777-12.766768-11.746532-19.554358-16.910135l-0.01228 0.011256c-6.986111-6.719028-16.47216-10.857279-26.930349-10.857279-21.464871 0-38.864146 17.400299-38.864146 38.864146 0 9.497305 3.411703 18.196431 9.071609 24.947182l-0.001023 0c0.001023 0.001023 0.00307 0.00307 0.005117 0.004093 2.718925 3.242857 5.953595 6.03853 9.585309 8.251941 3.664459 3.021823 7.261381 5.997598 10.624988 9.361205l3.203972 3.204995c40.279379 40.229237 28.254507 109.539812-12.024871 149.820214L371.157763 796.383956c-40.278355 40.229237-105.761766 40.229237-146.042167 0l-3.229554-3.231601c-40.281425-40.278355-40.281425-105.809861 0-145.991002l75.93546-75.909877c9.742898-7.733125 15.997346-19.668968 15.997346-33.072233 0-23.312962-18.898419-42.211381-42.211381-42.211381-8.797363 0-16.963347 2.693342-23.725354 7.297197-0.021489-0.045025-0.044002-0.088004-0.066515-0.134053l-0.809435 0.757247c-2.989077 2.148943-5.691629 4.669346-8.025791 7.510044l-78.913281 73.841775c-74.178443 74.229608-74.178443 195.632609 0 269.758863l3.203972 3.202948c74.178443 74.127278 195.529255 74.127278 269.707698 0l171.829484-171.880649c74.076112-74.17435 80.357166-191.184297 6.282077-265.311575L607.934444 417.856853z"
      fill="currentColor"
    />
    <path
      d="M855.61957 165.804257l-3.203972-3.203972c-74.17742-74.178443-195.528232-74.178443-269.706675 0L410.87944 334.479911c-74.178443 74.178443-78.263481 181.296089-4.085038 255.522628l3.152806 3.104711c3.368724 3.367701 6.865361 6.54302 10.434653 9.588379 2.583848 2.885723 5.618974 5.355985 8.992815 7.309476 0.025583 0.020466 0.052189 0.041956 0.077771 0.062422l0.011256-0.010233c5.377474 3.092431 11.608386 4.870938 18.257829 4.870938 20.263509 0 36.68962-16.428158 36.68962-36.68962 0-5.719258-1.309832-11.132548-3.645017-15.95846l0 0c-4.850471-10.891048-13.930267-17.521049-20.210297-23.802102l-3.15383-3.102664c-40.278355-40.278355-24.982998-98.79612 15.295358-139.074476l171.930791-171.830507c40.179095-40.280402 105.685018-40.280402 145.965419 0l3.206018 3.152806c40.279379 40.281425 40.279379 105.838513 0 146.06775l-75.686796 75.737962c-10.296507 7.628748-16.97358 19.865443-16.97358 33.662681 0 23.12365 18.745946 41.87062 41.87062 41.87062 8.048303 0 15.563464-2.275833 21.944801-6.211469 0.048095 0.081864 0.093121 0.157589 0.141216 0.240477l1.173732-1.083681c3.616364-2.421142 6.828522-5.393847 9.529027-8.792247l79.766718-73.603345C929.798013 361.334535 929.798013 239.981676 855.61957 165.804257z"
      fill="currentColor"
    />
  </svg>
);

const TextParseIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path
      d="M785.088 128H238.912C177.728 128 128 184.448 128 253.76v516.48C128 839.552 177.728 896 238.912 896h546.176c61.184 0 110.912-56.448 110.912-125.76v-516.48C896 184.448 846.272 128 785.088 128zM832 770.048c0 34.176-23.936 61.952-53.376 61.952H245.376c-29.44 0-53.376-27.776-53.376-61.952V253.952C192 219.776 215.936 192 245.376 192h533.248c29.44 0 53.376 27.776 53.376 61.952v516.096z"
      fill="currentColor"
    />
    <path
      d="M671.104 320H349.312C333.12 320 320 335.36 320 351.616c0 16.192 13.12 31.616 29.312 31.616h131.776l-.32 291.072a29.312 29.312 0 0 0 58.688 0l.256-291.072h131.392c16.192 0 29.312-15.424 29.312-31.616S687.296 320 671.104 320z"
      fill="currentColor"
    />
  </svg>
);

function computeAvoidOffset(
  bubblePx: { x: number; y: number },
  cardCenterPx: { x: number; y: number },
  strength: number
) {
  const dx = bubblePx.x - cardCenterPx.x;
  const dy = bubblePx.y - cardCenterPx.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: (dx / len) * strength, y: (dy / len) * strength };
}

const LandingHeroParseSection: React.FC = () => {
  const navigate = useNavigate();
  const { user, openAuthModal } = useAuth();
  const [mode, setMode] = useState<InputMode>('link');
  const [inputValue, setInputValue] = useState('');
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [isCardHover, setIsCardHover] = useState(false);
  const [hoverBubbleId, setHoverBubbleId] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<{
    w: number;
    h: number;
    cardCenter: { x: number; y: number };
  } | null>(null);

  const activeScene = SCENE_BUBBLES.find((s) => s.id === activeSceneId) || null;
  const placeholder =
    activeScene?.placeholder ||
    (mode === 'link'
      ? '粘贴你想整理的文章链接，例如：https://example.com/article'
      : '简单描述你想整理的内容，或直接粘贴一段文本…');

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const card = cardRef.current;
      if (!wrap || !card) return;
      const wrapRect = wrap.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const cardCenter = {
        x: cardRect.left - wrapRect.left + cardRect.width / 2,
        y: cardRect.top - wrapRect.top + cardRect.height / 2
      };
      setLayout({
        w: wrapRect.width,
        h: wrapRect.height,
        cardCenter
      });
    };

    measure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      if (wrapRef.current) ro.observe(wrapRef.current);
      if (cardRef.current) ro.observe(cardRef.current);
    }

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, []);

  const bubbleRender = useMemo(() => {
    const w = layout?.w ?? 1000;
    const h = layout?.h ?? 600;
    const cardCenter = layout?.cardCenter ?? { x: w * 0.5, y: h * 0.5 };
    return SCENE_BUBBLES.map((b) => {
      const x = b.anchor.x * w;
      const y = b.anchor.y * h;

      const avoid = isCardHover ? computeAvoidOffset({ x, y }, cardCenter, 34) : { x: 0, y: 0 };
      const isHover = hoverBubbleId === b.id;
      const isActive = activeSceneId === b.id;
      const opacity = isCardHover ? (isHover ? 0.88 : 0.72) : isHover ? 0.95 : 0.9;
      const blur = isCardHover ? (isHover ? 0 : 1.5) : 0;
      const scale = isHover ? 1.04 : 1;
      const duration = b.id === 'thinking' ? '16s' : b.id === 'meeting' ? '14s' : '18s';
      const floatClass =
        b.id === 'weixin-article'
          ? 'bubble-float-b'
          : b.id === 'reading'
          ? 'bubble-float-c'
          : 'bubble-float-a';
      const sizeClass = b.size === 'sm' ? 'px-3 py-1.5' : 'px-3.5 py-2';

      return {
        ...b,
        px: x,
        py: y,
        avoidX: avoid.x,
        avoidY: avoid.y,
        isHover,
        isActive,
        opacity,
        blur,
        scale,
        duration,
        floatClass,
        sizeClass
      };
    });
  }, [layout, isCardHover, hoverBubbleId, activeSceneId]);

  const closeStartMenu = useCallback(() => setStartMenuOpen(false), []);

  useEffect(() => {
    if (!startMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-start-menu-root="1"]')) return;
      closeStartMenu();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [startMenuOpen, closeStartMenu]);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-mode-menu-root="1"]')) return;
      setModeMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [modeMenuOpen]);

  const handleStartParse = () => {
    if (!user) {
      openAuthModal('login');
      return;
    }

    const trimmed = inputValue.trim();
    if (!trimmed) return;

    setWorkspaceStartAction({
      source: 'landing',
      mode,
      inputValue: trimmed,
      activeSceneId
    });
    navigate('/workspace');
  };

  const handleSaveDraft = () => {
    setStartMenuOpen(false);
  };

  return (
    <div className="flex flex-col items-center justify-center px-4 pb-10 pt-2">
      <style>{`
        @keyframes floatA {
          0%   { transform: translate(-50%, -50%) translate3d(0, 0, 0); }
          50%  { transform: translate(-50%, -50%) translate3d(0, -6px, 0); }
          100% { transform: translate(-50%, -50%) translate3d(0, 0, 0); }
        }
        @keyframes floatB {
          0%   { transform: translate(-50%, -50%) translate3d(0, 0, 0); }
          50%  { transform: translate(-50%, -50%) translate3d(-5px, -4px, 0); }
          100% { transform: translate(-50%, -50%) translate3d(0, 0, 0); }
        }
        @keyframes floatC {
          0%   { transform: translate(-50%, -50%) translate3d(0, 0, 0); }
          50%  { transform: translate(-50%, -50%) translate3d(5px, -3px, 0); }
          100% { transform: translate(-50%, -50%) translate3d(0, 0, 0); }
        }
        .bubble-float-a { animation-name: floatA; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
        .bubble-float-b { animation-name: floatB; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
        .bubble-float-c { animation-name: floatC; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
        .bubble-outer { will-change: transform; transition: transform 420ms cubic-bezier(.2,.8,.2,1); }
        .bubble-inner { will-change: transform; }
        @media (prefers-reduced-motion: reduce) {
          .bubble-float-a, .bubble-float-b, .bubble-float-c { animation: none !important; }
          .bubble-outer { transition: none !important; }
        }
      `}</style>

      <div className="w-full max-w-[1080px] rounded-[48px] border border-white/70 bg-white/90 px-4 pb-4 pt-6 shadow-[0_30px_60px_rgba(10,34,61,0.12)] backdrop-blur">
        <div ref={wrapRef} className="relative w-full min-h-[300px]">
          <div className="absolute inset-0 z-10">
            {bubbleRender.map((b) => (
              <div
                key={b.id}
                className="bubble-outer absolute"
                style={{
                  left: b.px,
                  top: b.py,
                  transform: `translate(calc(-50% + ${b.avoidX}px), calc(-50% + ${b.avoidY}px))`
                }}
              >
                <button
                  type="button"
                  onMouseEnter={() => setHoverBubbleId(b.id)}
                  onMouseLeave={() => setHoverBubbleId(null)}
                  onClick={() => {
                    setMode(b.mode);
                    setActiveSceneId(b.id);
                    setInputValue('');
                  }}
                  className={[
                    'bubble-inner inline-flex items-center gap-1.5 rounded-full border text-xs shadow-sm backdrop-blur',
                    'transition-[background-color,border-color,box-shadow,filter,opacity] duration-200',
                    b.sizeClass,
                    b.floatClass,
                    b.isActive
                      ? 'border-[#06c3a8] bg-white text-[#0a6154] shadow-[0_10px_30px_rgba(6,195,168,0.16)]'
                      : 'border-white/70 bg-white/80 text-slate-600 hover:bg-white',
                    b.isHover ? 'shadow-md' : ''
                  ].join(' ')}
                  style={{
                    animationDuration: b.duration,
                    opacity: b.opacity,
                    filter: b.blur ? `blur(${b.blur}px)` : 'none',
                    transform: `scale(${b.scale})`
                  }}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center">{b.icon}</span>
                  <span className="whitespace-nowrap">{b.label}</span>
                </button>
              </div>
            ))}
          </div>

          <div className="relative z-20 px-8 pb-20 pt-16 md:px-16 md:pb-24">
            <div
              ref={cardRef}
              onMouseEnter={() => setIsCardHover(true)}
              onMouseLeave={() => setIsCardHover(false)}
              className="mx-auto max-w-3xl text-center"
            >
              <h1 className="text-[56px] font-semibold tracking-[1.5px] text-[#0a223d] md:text-[56px]">
                开始回响之旅
              </h1>
	              <p className="mt-3 max-w-2xl mx-auto text-center text-[13px] leading-relaxed text-slate-500 md:text-[14px]">
	                &lt;支持链接解析、随手记&gt;
	              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 w-full max-w-4xl space-y-4">
        <div className="rounded-[999px] border border-white/70 bg-white/90 px-4 py-2 shadow-[0_20px_48px_rgba(15,23,42,0.12)] backdrop-blur focus-within:border-[#d7ecff] focus-within:ring-2 focus-within:ring-[#e3f2ff] transition">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-600 md:w-auto" data-mode-menu-root="1">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setModeMenuOpen((prev) => !prev)}
                  className="inline-flex h-10 w-[180px] items-center gap-2 rounded-full px-4 text-xs font-medium text-slate-700 transition hover:text-[#0a6154]"
                >
                  <span className="text-slate-500">
                    {mode === 'link' ? (
                      <LinkParseIcon className="h-4 w-4 text-slate-500" />
                    ) : (
                      <TextParseIcon className="h-4 w-4 text-slate-500" />
                    )}
                  </span>
	                  <span>{mode === 'link' ? '链接解析' : '随手记'}</span>
                  <span className="ml-auto text-slate-400">
                    <svg className={`h-3 w-3 transition ${modeMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none">
                      <path
                        d="M6 9l6 6 6-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
                {modeMenuOpen && (
                  <div className="absolute left-0 top-[calc(100%+6px)] w-[180px] rounded-2xl shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
	                      {[
	                        { value: 'link' as InputMode, label: '链接解析', Icon: LinkParseIcon },
	                        { value: 'text' as InputMode, label: '随手记', Icon: TextParseIcon }
	                      ].map(({ value, label, Icon }) => {
                        const active = mode === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              setMode(value);
                              setActiveSceneId(null);
                              setModeMenuOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 px-4 py-2 text-[12px] ${
                              active ? 'bg-[#4b8dff]/15 text-[#1f4fd9]' : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <span className="text-slate-500">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="flex-1 text-left">{label}</span>
                            {active && (
                              <svg className="h-4 w-4 text-[#1f4fd9]" viewBox="0 0 24 24" fill="none">
                                <path
                                  d="M5 13l4 4L19 7"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-3">
                <div className="flex-1">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={placeholder}
                    className="w-full rounded-full border border-transparent bg-transparent px-5 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
                  />
                </div>
                <div className="flex items-center">
                  <div className="relative inline-flex flex-1" data-start-menu-root="1">
                    <button
                      type="button"
                      onClick={handleStartParse}
                      className="inline-flex items-center justify-center gap-2 rounded-l-full bg-gradient-to-r from-[#06c3a8] to-[#43ccb0] px-5 py-2 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(6,195,168,0.32)] hover:brightness-110 transition"
	                    >
	                      <span className="text-base">✨</span>
	                      <span>{mode === 'link' ? '开始解析' : 'AI分配'}</span>
	                    </button>
                    <button
                      type="button"
                      onClick={() => setStartMenuOpen((v) => !v)}
                      className="inline-flex items-center justify-center rounded-r-full bg-gradient-to-r from-[#06c3a8] to-[#43ccb0] px-3 py-2 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(6,195,168,0.32)] hover:brightness-110 transition"
                      aria-haspopup="menu"
                      aria-expanded={startMenuOpen}
                      title="更多操作"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M6 9l6 6 6-6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>

                    {startMenuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full mt-2 w-40 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-lg backdrop-blur"
                      >
                        <button
                          type="button"
                          onClick={handleSaveDraft}
                          className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                          role="menuitem"
                        >
                          存草稿
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingHeroParseSection;
