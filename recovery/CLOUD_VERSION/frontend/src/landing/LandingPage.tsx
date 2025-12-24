import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import LandingHeroParseSection from '../components/LandingHeroParseSection';
import { useAuth } from '../auth/AuthContext';
import UserAvatarMenu from '../components/UserAvatarMenu';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, openAuthModal } = useAuth();
  const scrollToFeatures = useCallback(() => {
    if (typeof window === 'undefined') return;
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const features = [
    {
      title: '内容分析与总结',
      desc: '一键生成摘要与要点结构\n把长内容变成清晰条目\n读得快用得上',
      icon: (
        <svg
          viewBox="0 0 1024 1024"
          xmlns="http://www.w3.org/2000/svg"
          className="h-8 w-8 text-[#06c3a8]"
          fill="currentColor"
        >
          <path d="M744 240H424a40 40 0 0 0 0 80h320a40 40 0 0 0 0-80z" />
          <path d="M280 280m-40 0a40 40 0 1 0 80 0 40 40 0 1 0-80 0Z" />
          <path d="M744 472H424a40 40 0 0 0 0 80h320a40 40 0 0 0 0-80z" />
          <path d="M280 512m-40 0a40 40 0 1 0 80 0 40 40 0 1 0-80 0Z" />
          <path d="M744 704H424a40 40 0 0 0 0 80h320a40 40 0 0 0 0-80z" />
          <path d="M280 744m-40 0a40 40 0 1 0 80 0 40 40 0 1 0-80 0Z" />
          <path d="M858 64H166a70 70 0 0 0-70 70v756a70 70 0 0 0 70 70h692a70 70 0 0 0 70-70V134a70 70 0 0 0-70-70z m-10 776a40 40 0 0 1-40 40H216a40 40 0 0 1-40-40V184a40 40 0 0 1 40-40h592a40 40 0 0 1 40 40z" />
        </svg>
      ),
    },
    {
      title: '智能归类与标签',
      desc: '基于内容语义推荐分类与标签\n减少手动整理成本\n让笔记库更有秩序',
      icon: (
        <svg
          viewBox="0 0 1024 1024"
          xmlns="http://www.w3.org/2000/svg"
          className="h-8 w-8 text-[#06c3a8]"
          fill="currentColor"
        >
          <path d="M256 682.624A42.688 42.688 0 0 0 256 768h0.384a42.688 42.688 0 1 0 0-85.376H256zM717.44 723.392a42.688 42.688 0 0 1 30.144-52.288l0.384-0.064a42.688 42.688 0 0 1 22.08 82.432l-0.32 0.064a42.624 42.624 0 0 1-52.288-30.144z" />
          <path d="M257.344 96h-2.688c-28.736 0-52.224 0-71.296 1.536-19.84 1.664-37.632 5.12-54.336 13.568-26.048 13.312-47.296 34.56-60.608 60.608-8.448 16.64-11.904 34.56-13.504 54.272-1.6 19.136-1.6 42.624-1.6 71.36v429.312c0 28.8 0 52.224 1.6 71.36 1.6 19.776 5.056 37.632 13.504 54.272 13.312 26.112 34.56 47.36 60.608 60.608 16.64 8.512 34.56 11.904 54.336 13.568 19.072 1.536 42.56 1.536 71.296 1.536h2.688c28.736 0 52.224 0 71.296-1.536 19.84-1.664 37.632-5.12 54.336-13.568 26.048-13.312 47.296-34.56 60.608-60.608 8.448-16.64 11.904-34.56 13.504-54.272 1.6-19.136 1.6-42.624 1.6-71.36V365.248l107.328 402.368c7.296 27.328 13.248 49.664 19.584 67.392 6.528 18.368 14.336 34.56 26.688 48.32 19.264 21.44 44.8 36.288 73.088 42.304 18.048 3.84 35.904 2.56 55.04-0.896 18.56-3.392 40.768-9.408 67.904-16.704l2.56-0.704c27.2-7.296 49.472-13.312 67.2-19.648 18.304-6.592 34.432-14.4 48.128-26.88a136.96 136.96 0 0 0 42.112-73.216c3.84-18.048 2.56-35.968-0.96-55.168-3.328-18.56-9.28-40.896-16.64-68.16l-108.8-407.872a938.496 938.496 0 0 0-19.52-67.392c-6.592-18.368-14.4-34.56-26.688-48.32a136.32 136.32 0 0 0-73.088-42.304c-18.048-3.84-35.904-2.56-55.04 0.896-18.56 3.392-40.768 9.408-67.968 16.704l-2.56 0.64c-27.136 7.36-49.408 13.376-67.136 19.712-18.304 6.592-34.432 14.464-48.128 26.88-11.52 10.368-21.12 22.656-28.48 36.16a115.648 115.648 0 0 0-9.728-27.648 138.688 138.688 0 0 0-60.608-60.608c-16.64-8.512-34.56-11.904-54.336-13.568A948.416 948.416 0 0 0 257.344 96z m-140.032 629.312V330.688h277.376v394.624c0 30.4 0 51.264-1.344 67.456-1.28 15.808-3.712 24.32-6.784 30.464-7.168 14.08-18.56 25.472-32.64 32.64-6.144 3.136-14.656 5.504-30.464 6.784-16.192 1.28-37.056 1.344-67.456 1.344-30.4 0-51.264 0-67.456-1.344-15.808-1.28-24.32-3.648-30.464-6.784a74.624 74.624 0 0 1-32.64-32.64c-3.072-6.144-5.44-14.656-6.784-30.464a922.24 922.24 0 0 1-1.28-67.456z m1.344-494.08c1.28-15.808 3.712-24.32 6.784-30.464 7.168-14.08 18.56-25.472 32.64-32.64 6.144-3.136 14.72-5.504 30.464-6.784A921.6 921.6 0 0 1 256 160c30.4 0 51.264 0 67.456 1.344 15.808 1.28 24.32 3.648 30.464 6.784 14.08 7.168 25.472 18.56 32.64 32.64 3.072 6.144 5.44 14.656 6.784 30.464a505.6 505.6 0 0 1 1.28 35.456H117.376c0.128-14.272 0.448-25.728 1.28-35.456z m496.32-53.12c28.8-7.68 48.512-12.992 64.064-15.872 15.232-2.752 23.744-2.688 30.208-1.28 14.976 3.2 28.544 11.008 38.784 22.464 4.48 4.992 8.832 12.352 14.08 27.008 1.92 5.504 3.84 11.648 5.952 18.624L509.952 308.48a442.24 442.24 0 0 1-6.4-28.352c-2.752-15.296-2.688-23.936-1.28-30.464 3.2-15.104 11.072-28.8 22.4-39.04 4.992-4.48 12.288-8.832 26.88-14.08 14.912-5.376 34.624-10.688 63.36-18.432zM526.272 370.432l258.624-79.616 103.68 388.672c7.68 28.8 12.992 48.64 15.808 64.384 2.816 15.296 2.688 23.936 1.28 30.464-3.2 15.104-11.008 28.8-22.4 39.04-4.928 4.48-12.288 8.832-26.88 14.08-14.912 5.376-34.56 10.688-63.36 18.432-28.8 7.68-48.512 12.992-64.128 15.872-15.232 2.752-23.68 2.688-30.208 1.28a72.32 72.32 0 0 1-38.72-22.464c-4.48-4.992-8.832-12.352-14.08-27.008a909.568 909.568 0 0 1-18.368-63.744L526.272 370.432z" />
        </svg>
      ),
    },
    {
      title: '可视化复盘与洞察',
      desc: '用图表查看分类分布\n主题趋势与关键变化\n把积累变成可复盘的洞察',
      icon: (
        <svg
          viewBox="0 0 1024 1024"
          xmlns="http://www.w3.org/2000/svg"
          className="h-8 w-8 text-[#06c3a8]"
          fill="currentColor"
        >
          <path d="M853.333333 85.333333a85.333333 85.333333 0 0 1 85.333334 85.333334v512a85.333333 85.333333 0 0 1-85.333334 85.333333H170.666667a85.333333 85.333333 0 0 1-85.333334-85.333333V170.666667a85.333333 85.333333 0 0 1 85.333334-85.333334h682.666666z m0 59.733334H170.666667a25.6 25.6 0 0 0-25.258667 21.461333L145.066667 170.666667v512a25.6 25.6 0 0 0 21.461333 25.258666L170.666667 708.266667h682.666666a25.6 25.6 0 0 0 25.258667-21.461334L878.933333 682.666667V170.666667a25.6 25.6 0 0 0-21.461333-25.258667L853.333333 145.066667z" />
          <path d="M813.653333 341.12a29.866667 29.866667 0 0 1-0.725333 39.253333l-2.901333 2.816-163.413334 137.130667a72.533333 72.533333 0 0 1-98.005333-4.309333l-4.224-4.608-109.653333-130.688a12.8 12.8 0 0 0-15.530667-3.2l-2.474667 1.621333-163.84 138.154667a29.866667 29.866667 0 0 1-41.429333-42.837334l2.901333-2.816 163.84-138.154666a72.576 72.576 0 0 1 98.133334 4.224l4.181333 4.608 109.653333 130.688a12.8 12.8 0 0 0 15.573334 3.2l2.432-1.621334 163.413333-137.130666a29.866667 29.866667 0 0 1 42.112 3.669333zM823.466667 853.333333a29.866667 29.866667 0 0 1 0 59.733334H200.533333a29.866667 29.866667 0 0 1 0-59.733334h622.933334z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-[#eef6fd] pt-0 pb-4">
      {/* Landing Navigation（与 /workspace 顶部导航互相独立） */}
      <div className="sticky top-0 z-50 border-b border-[#e0f1fb] bg-[#f8fcff]/80 backdrop-blur">
        <div className="mx-auto w-full max-w-[1400px] px-[10px]">
          <nav className="mx-auto flex h-[72px] w-full max-w-[1200px] flex-wrap items-center px-6 py-0">
            <div className="flex items-center">
              <div className="w-[9ch]">
                <div className="flex justify-between text-lg font-semibold text-slate-900">
                  {'回响笔记'.split('').map((char, index) => (
                    <span key={`${char}-${index}`}>{char}</span>
                  ))}
                </div>
                <div className="flex justify-between whitespace-nowrap text-xs text-slate-400">
                  {'Echo Notes'.split('').map((char, index) => (
                    <span key={`${char}-${index}`}>{char === ' ' ? '\u00A0' : char}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-10">
              <div className="hidden items-center gap-10 text-sm font-medium text-slate-600 lg:flex">
                {['产品功能', '使用指南', '联系我们'].map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={item === '产品功能' ? scrollToFeatures : undefined}
                    className="transition-colors hover:text-[#06c3a8]"
                  >
                    {item}
                  </button>
                ))}
              </div>
              <UserAvatarMenu variant="landing" />
            </div>
          </nav>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1400px] px-[10px]">
        {/* Hero */}
        <section className="min-h-[calc(100vh-72px)] pb-[64px]">
          {/* 这里 pt 你原来的值保留，避免你说的“顶/不顶”反复 */}
          <div className="mx-auto w-full max-w-[1200px] px-6 pt-[50px] xl:pt-[40px]">
            {/* 关键：不要再用左列 -mt；用 grid 整体上移，让文字+插画一起动 */}
            <div className="grid items-center gap-10 lg:grid-cols-2 xl:grid-cols-[1.1fr_1fr] xl:gap-x-[48px]">
              <div className="flex flex-col justify-center">
                <h1 className="mb-[18px] text-[96px] font-semibold leading-[1.22] tracking-[1.5px] text-[#0a223d] md:text-[72px]">
                  让内容，更有序
                </h1>
                <p className="mb-[18px] text-[40px] font-medium leading-[1.4] tracking-[1.5px] text-[#06c3a8] md:text-[44px]">
                  AI 自动整理
                </p>
                <p className="mb-[30px] text-[22px] font-normal leading-[1.7] tracking-[1.5px] text-slate-600 md:text-[24px]">
                  要点提炼 ｜ 标签归类 ｜ 图表总结
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    onClick={() => (user ? navigate('/workspace') : openAuthModal('login'))}
                    className="w-full rounded-full bg-[#06c3a8] px-8 py-4 text-lg font-semibold tracking-[1.5px] text-white shadow-xl shadow-[#9ee3d8] transition hover:bg-[#04b094] sm:w-auto"
                  >
                    {user ? '开始记录' : '立即试用'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-start">
                <img
                  src="/illustrations/ai-note-hero.svg"
                  alt="AI 插画"
                  className="h-auto w-full max-w-[520px] object-contain drop-shadow-[0_30px_60px_rgba(10,34,61,0.25)]"
                />
              </div>
            </div>

            <div className="mt-10">
              <LandingHeroParseSection />
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="relative scroll-mt-[88px]">
          <div className="mx-auto w-full max-w-[1200px] px-4">
            <div className="mt-16 rounded-[32px] border border-[#e0f1fb] bg-white/80 backdrop-blur shadow-[0_20px_60px_rgba(10,34,61,0.08)]">
              <div className="px-6 pb-10 pt-8 md:px-10 md:pb-12 md:pt-9">
                <div className="-mt-2 flex flex-col items-center gap-2 text-center md:-mt-3">
                  <p className="flex items-center justify-center gap-2 text-[30px] font-semibold tracking-[1.5px] text-[#06c3a8]">
                    <svg
                      viewBox="0 0 1024 1024"
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-[30px] w-[30px]"
                      fill="currentColor"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M488.530747 1024a460.965495 460.965495 0 1 1 140.19491-900.416646L597.405737 222.17697a357.34497 357.34497 0 1 0 232.727273 448.90505l98.572929 31.319919a460.675879 460.675879 0 0 1-396.898262 319.508687q-21.783273 2.110061-43.27693 2.089374z" />
                      <path d="M490.785616 643.899475h-109.226667l-23.665777 86.491798h-68.266667l107.88202-336.844283h79.189334l108.337131 336.844283h-70.542222z m-14.480808-52.337778l-10.012444-36.884687c-10.467556-35.043556-19.569778-73.728-29.582223-110.136889h-1.820444c-8.647111 36.864-18.618182 75.093333-28.672 110.136889l-10.012444 36.884687z" />
                      <path d="M633.690505 393.54699h67.356444v336.844283h-67.356444z" />
                      <path d="M768.113778 72.40404h227.555555v82.747475h-227.555555z" />
                      <path d="M840.517818 227.555556V0h82.747475v227.555556z" />
                    </svg>
                    <span>核心能力</span>
                  </p>
                  <h2 className="mt-2 text-[20px] font-semibold leading-[1.25] tracking-[1.5px] text-[#0a223d]">
                    碎片化信息，AI一键整理
                  </h2>
                </div>

                <div className="mt-10 grid gap-6 md:grid-cols-3">
                  {features.map((feature) => (
                    <div
                      key={feature.title}
                      className="rounded-[24px] border border-[#e0f1fb] bg-[#e6fbf7]/60 p-6 text-center"
                    >
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white">
                        {feature.icon}
                      </div>
                      <h3 className="text-lg font-semibold text-[#0a223d]">
                        {feature.title}
                      </h3>
                      <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-slate-500">
                        {feature.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="mx-auto mt-10 w-full max-w-[1200px] px-4 pb-10">
          <div className="flex justify-end">
            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-right text-[12px] font-normal text-[#8A8F98]">
              {['关于', '使用条款', '隐私政策'].map((link) => (
                <span key={link} className="cursor-pointer transition-colors hover:text-[#4B5563]">
                  {link}
                </span>
              ))}
              <span>© 2025 回响笔记</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default LandingPage;
