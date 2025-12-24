import React, { useLayoutEffect, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { type Notebook } from '../apiClient';
import { DEFAULT_AI_SUMMARY_PROMPT, PARSE_SETTINGS_STORAGE_KEY, readTextPrompt } from '../constants/aiSummary';
import { PARSE_HISTORY_EVENTS } from '../constants/events';
import { useAiSummaryPrompts } from '../hooks/useAiSummaryPrompts';
import { useOutsideClose } from '../hooks/useOutsideClose';
import { computeAvoidOffset, saveQuickNoteDraft } from '../utils/workspaceUtils';
import { consumeWorkspaceStartAction } from '../utils/workspaceStartAction';
import ParseHistoryPanel from './ParseHistoryPanel';
import FieldTemplateModal from './FieldTemplateModal';
import { useFieldTemplate } from '../hooks/useFieldTemplate';

type InputMode = 'link' | 'text';

type SceneBubble = {
  id: string;
  label: string;
  icon: React.ReactNode;
  mode: InputMode;
  placeholder?: string;
  // 0~1: container 内的相对位置（用于稳定布局）
  anchor: { x: number; y: number };
  // 尺寸层级（仅用于视觉层次）
  size?: 'sm' | 'md';
};

const MeetingNoteIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M324.266667 136.533333a34.133333 34.133333 0 0 1 2.56 68.181334L324.266667 204.8h-119.466667v682.666667h614.4V204.8h-110.933333a34.133333 34.133333 0 0 1-2.56-68.181333L708.266667 136.533333H819.2a68.266667 68.266667 0 0 1 68.181333 64.853334L887.466667 204.8v682.666667a68.266667 68.266667 0 0 1-64.853334 68.181333L819.2 955.733333H204.8a68.266667 68.266667 0 0 1-68.181333-64.853333L136.533333 887.466667V204.8a68.266667 68.266667 0 0 1 64.853334-68.181333L204.8 136.533333h119.466667z"
      fill="#444444"
    />
    <path
      d="M631.466667 68.266667H392.533333c-56.405333 0-102.4 45.994667-102.4 102.4s45.994667 102.4 102.4 102.4h238.933334c56.405333 0 102.4-45.994667 102.4-102.4s-45.994667-102.4-102.4-102.4zM392.533333 136.533333h238.933334c18.688 0 34.133333 15.445333 34.133333 34.133334s-15.445333 34.133333-34.133333 34.133333H392.533333c-18.688 0-34.133333-15.445333-34.133333-34.133333s15.445333-34.133333 34.133333-34.133334z"
      fill="#444444"
    />
    <path
      d="M496.7936 358.4c104.704 0 189.576533 84.872533 189.576533 189.576533 0 40.021333-12.407467 77.141333-33.570133 107.741867l71.0656 71.0656-48.264533 48.2816-71.0656-71.082667a188.706133 188.706133 0 0 1-107.741867 33.570134C392.0896 737.553067 307.2 652.680533 307.2 547.976533 307.2 443.272533 392.0896 358.4 496.7936 358.4z m0 68.266667a121.309867 121.309867 0 1 0-0.017067 242.6368A121.309867 121.309867 0 0 0 496.7936 426.666667z"
      fill="#00B386"
    />
  </svg>
);

const InspirationNoteIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M648.533333 674.474667a34.133333 34.133333 0 0 1 34.048 31.607466l0.085334 2.542934v51.2a68.266667 68.266667 0 0 1-64.853334 68.181333l-3.413333 0.085333H409.6a68.266667 68.266667 0 0 1-68.181333-64.853333l-0.085334-3.413333v-51.2a34.133333 34.133333 0 0 1 68.181334-2.56l0.085333 2.56v51.2h204.8v-51.2a34.133333 34.133333 0 0 1 34.133333-34.133334zM597.333333 871.1168a34.133333 34.133333 0 0 1 2.56 68.164267l-2.56 0.1024H426.666667a34.133333 34.133333 0 0 1-2.56-68.181334l2.56-0.085333h170.666666z"
      fill="#444444"
    />
    <path
      d="M512 51.2c197.9392 0 358.4 160.4608 358.4 358.4 0 145.749333-80.554667 272.7936-208.213333 328.567467a34.133333 34.133333 0 0 1-27.306667-62.549334C737.28 630.852267 802.133333 528.5888 802.133333 409.6c0-160.238933-129.8944-290.133333-290.133333-290.133333s-290.133333 129.8944-290.133333 290.133333c0 118.9888 64.836267 221.252267 167.253333 266.018133a34.133333 34.133333 0 0 1-27.306667 62.549334C234.154667 682.3936 153.6 555.349333 153.6 409.6 153.6 211.6608 314.0608 51.2 512 51.2z"
      fill="#444444"
    />
    <path
      d="M490.018133 204.868267L494.933333 204.8v68.266667c-64.477867 0-117.230933 51.421867-119.3984 115.370666L375.466667 392.533333a34.133333 34.133333 0 0 1-68.181334 2.56L307.2 392.533333c0-101.888 81.527467-185.053867 182.818133-187.665066z"
      fill="#00B386"
    />
  </svg>
);

const BookExcerptIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
	    <path
	      d="M856.731788 389.991732c-5.439934-2.655968-11.999853-2.015975-16.831794 1.727979l-198.557574 154.046118c-3.903952 3.039963-6.175925 7.711906-6.175925 12.671845l0 79.42303c0 6.079926 3.455958 11.679857 8.959891 14.367824 2.207973 1.087987 4.639943 1.63198 7.039914 1.63198 3.487957 0 6.943915-1.119986 9.82388-3.327959l198.557574-154.078117c3.903952-3.039963 6.175925-7.711906 6.175925-12.639846l0-79.42303C865.723678 398.247631 862.235721 392.679699 856.731788 389.991732zM833.724069 475.942682l-166.557965 129.246421 0-38.943524 166.557965-129.246421L833.724069 475.942682z"
	      fill="#00B386"
	    />
    <path
      d="M913.883089 177.290331c-18.687772-9.119889-42.143485-6.655919-58.719283 6.143925-2.46397 1.951976-5.439934 4.255948-8.351898 6.495921-40.735502 1.63198-68.959157-20.319752-79.039034-29.695637L767.772875 138.762802c0-13.08784-8.127901-30.399629-23.647711-38.079535-8.2239-4.06395-25.183692-8.511896-45.759441 7.199912-4.479945 3.071962-54.01534 36.895549-110.718647 75.807074L587.647076 86.923435c0-5.919928-3.26396-11.327862-8.447897-14.111828-5.215936-2.783966-11.48786-2.46397-16.447799 0.79999-0.543993 0.351996-12.223851 8.127901-30.207631 20.063755-72.159118 5.471933-125.278469-19.007768-143.486247-29.183643L389.057502 16.012302c0-5.855928-3.199961-11.263862-8.351898-14.047828-5.151937-2.847965-11.391861-2.559969-16.319801 0.607993-1.983976 1.279984-198.685572 128.47843-231.61317 147.2942C74.885341 182.858263 78.405298 247.209477 79.04529 254.825384l0 484.50608c0 21.087742 10.879867 39.967512 31.423616 54.559333 27.999658 19.871757 73.215105 30.783624 117.310567 30.783624 24.959695 0 49.567394-3.487957 70.527138-10.847867 1.759978-0.607993 3.391959-1.535981 4.831941-2.719967l53.951341-44.095461 0 121.630514c0 84.734965 93.566857 135.358346 183.997752 135.358346 37.759539 0 72.095119-8.735893 99.294787-25.279691 47.231423-28.67165 270.524695-202.077531 278.716594-208.573451 16.3518-10.303874 26.079681-27.935659 26.079681-47.167424L945.178707 227.33772C945.178707 206.153979 932.858858 186.506219 913.883089 177.290331zM717.085494 133.834862c2.591968-1.983976 9.02389-6.367922 12.831843-4.447946 3.551957 1.759978 5.855928 7.455909 5.855928 9.375885l0 28.063657c0 3.903952 1.407983 7.647907 3.967952 10.559871 1.375983 1.567981 27.583663 30.175631 70.655137 40.799501-75.711075 58.591284-195.901606 150.398162-227.645218 169.469929-26.559675 15.935805-54.303336 23.999707-82.398993 23.999707-14.75182 0-26.559675-2.303972-33.887586-4.255948-23.71171-6.303923-38.751527-16.415799-44.767453-30.047633-7.135913-16.191802-0.255997-34.207582 2.143974-39.647516 3.583956-3.103962 7.167912-6.207924 11.519859-9.439885C471.968489 301.256816 714.013532 135.978836 717.085494 133.834862zM148.64444 177.642327c26.847672-15.327813 153.918119-97.086814 208.445453-132.254384l0 28.159656c0 5.247936 2.591968 10.175876 6.879916 13.151839 2.367971 1.63198 48.351409 32.031609 121.08652 38.49553-76.479066 50.655381-186.205725 122.942498-217.853338 141.918266C210.81968 300.93682 162.820267 311.464692 135.4926 295.976881 115.300847 284.521021 111.044899 260.745311 111.044899 242.82553c0-0.032-0.032-0.095999-0.032-0.127998C111.940888 226.633728 117.796817 195.242112 148.64444 177.642327zM285.154772 784.514912c-47.935414 15.51981-121.502515 7.839904-156.158092-16.703796-11.903855-8.479896-17.951781-18.01578-17.951781-28.479652L111.044899 318.056611c2.719967 2.079975 5.631931 3.999951 8.671894 5.75993 38.143534 21.567736 96.382822 11.231863 163.933997-29.247643 38.911525-23.327715 188.605695-122.398504 259.484829-169.469929 0.511994-0.032 0.927989 0 1.439982-0.063999 4.671943-0.511994 8.511896-3.007963 11.071865-6.52792l0 81.950999c0 1.63198 0.479994 3.103962 0.895989 4.575944-61.183252 42.047486-122.718501 84.574967-140.190287 97.470809-24.607699 18.175778-38.655528 35.967561-47.103424 52.639357-6.879916 12.223851-12.191851 26.271679-12.191851 40.575504l0 329.979968L285.154772 784.514912zM913.179098 743.011419c0 8.1919-4.191949 15.679808-12.447848 20.991744-2.303972 1.791978-231.325173 179.613805-276.988616 207.357466C601.566906 984.864464 572.959255 992.000376 541.087645 992.000376c-74.719087 0-151.998143-38.655528-151.998143-103.358737L389.089502 420.45536c0-0.063999 0.032-0.095999 0.032-0.159998l0-3.839953c-0.032-9.503884 0-19.167766 2.111974-29.215643 0.319996 0.863989 0.671992 1.759978 1.023987 2.623968 10.015878 23.199717 32.255606 39.487518 66.015193 48.479408 13.11984 3.487957 27.679662 5.311935 42.079486 5.311935 33.983585 0 67.263178-9.599883 98.878792-28.543651 40.8955-24.607699 212.829399-157.406077 275.548633-206.429478 7.135913-5.471933 16.991792-6.623919 25.087693-2.623968 8.2239 3.967952 13.311837 12.127852 13.311837 21.27974L913.179098 743.011419z"
      fill="#515151"
    />
  </svg>
);

const ArticleIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M936.7 612.2c-1-119.8-100.1-213.8-219.1-232.7C692 246.6 561.9 149 406 148.7 240.7 148.9 91.2 269 89.9 426.5c0.4 83.8 49.7 154.4 113.6 207.7l-19.7 66.7c-3.5 11.6 0.4 23.9 9.8 31.5 9.4 7.5 22.3 8.6 32.8 2.8l82.5-46c15.6 3.8 31.6 7.7 48.2 10.6 15.8 2.7 32 4.6 48.8 4.6 8.8 0 17.3-0.6 25.9-1.2 39.6 86.3 133.5 145.3 242.5 145.5 28-0.1 53.9-6.2 77.8-12.2l65 37.1c10.5 6 23.5 5 32.9-2.5 9.4-7.4 13.4-19.9 10.1-31.4l-15.3-53c51.6-44.9 91.5-104 91.9-174.5zM406 645.3c-12.3 0-25.2-1.4-38.7-3.7-17.7-3-36.2-7.8-55.4-12.5l-21.5 2.8-29.4 16.4 4.8-16.3c3.5-11.8-0.6-24.4-10.4-31.9-63.7-48.5-106.8-110.4-106.4-173.6 0.3-116.1 118.9-218.5 257-218.7 126.1 0.3 224.2 74.2 250.3 168.9-135.7 8.5-244 108.3-244.4 235.5 0 11.1 1.2 22 2.8 32.6-2.9 0.1-5.8 0.5-8.7 0.5z m376.9 139.4l0.4 1.4-12-6.9-21.9-3c-27.5 7.1-52.9 13.4-74.9 13.3-116.8-0.4-203.2-81.8-203.4-177.3 0.2-95.2 86.7-177 203.4-177.3 109.1 0.2 203 83.4 203.2 177.3 0.4 50.7-33.6 101.2-84.6 141-9.6 7.4-13.6 19.9-10.2 31.5z"
      fill="#515151"
    />
	    <path
	      d="M286.5 316.3c-27.2 0-49.2 22-49.2 49.2 0 27.2 22 49.2 49.2 49.2 27.2 0 49.2-22 49.2-49.2 0.1-27.2-22-49.2-49.2-49.2zM463.7 414.7c27.2 0 49.3-22 49.3-49.2 0-27.2-22-49.2-49.3-49.2-27.2 0-49.2 22-49.2 49.2 0 27.2 22.1 49.2 49.2 49.2zM611.5 552.6c-2.7 0-5.4 0.3-7.9 0.8-17.9 3.7-31.4 19.5-31.4 38.6 0 19 13.5 34.9 31.4 38.6 2.6 0.5 5.2 0.8 7.9 0.8 21.7 0 39.4-17.6 39.4-39.4 0-21.8-17.7-39.4-39.4-39.4zM749.3 552.6c-8.2 0-15.7 2.5-22 6.7-6.3 4.2-11.3 10.3-14.3 17.3-2 4.7-3.1 9.9-3.1 15.3s1.1 10.6 3.1 15.3c3 7.1 8 13.1 14.3 17.3 6.3 4.2 13.9 6.7 22 6.7 21.8 0 39.4-17.6 39.4-39.4 0-21.6-17.6-39.2-39.4-39.2z"
	      fill="#00B386"
	    />
	  </svg>
	);

const TodoIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M358.4 76.8v76.8h307.2V76.8h76.8v76.8h204.8v793.6H76.8V153.6h204.8V76.8h76.8z m-76.8 153.6H153.6v640h716.8V230.4h-128v76.8h-76.8V230.4H358.4v76.8h-76.8V230.4z"
      fill="#515151"
    />
    <path
      d="M700.5184 383.0784l54.2976 54.3232-307.712 307.712-181.0432-180.992 54.3232-54.3232 126.72 126.72 253.4144-253.44z"
      fill="#00B386"
    />
  </svg>
);

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
    label: '灵感随笔',
    icon: <InspirationNoteIcon className="h-4 w-4" />,
    mode: 'text',
    placeholder: '写下一段想法或灵感，AI 会帮你整理成可复用的思考卡片…',
    anchor: { x: 0.60, y: 0.22 },
    size: 'md'
  },
  {
    id: 'reading',
    label: '读书摘录',
    icon: <BookExcerptIcon className="h-4 w-4" />,
    mode: 'text',
    placeholder: '粘贴一段你正在阅读的内容，AI 会帮你提炼要点…',
    anchor: { x: 0.80, y: 0.32 },
    size: 'sm'
  },
  {
    id: 'weixin-article',
    label: '公众号长文',
    icon: <ArticleIcon className="h-4 w-4" />,
    mode: 'link',
    placeholder: '粘贴公众号/知乎等文章链接，交给 AI 帮你拆解…',
    anchor: { x: 0.24, y: 0.70 },
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
  <svg
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
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
  <svg
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
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

// —— 工具：计算从 card center 指向 bubble 的单位向量 * 强度（用于“让路”偏移）——

type CreateWorkspacePageProps = {
  notebooks: Notebook[];
  onRequestNotebookRefresh?: () => void;
};

const CreateWorkspacePage: React.FC<CreateWorkspacePageProps> = ({
  notebooks,
  onRequestNotebookRefresh
}) => {
  const navigate = useNavigate();

  const [mode, setMode] = useState<InputMode>('link');
  const [inputValue, setInputValue] = useState('');
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [startActionLoading, setStartActionLoading] = useState(false);
  const [startActionError, setStartActionError] = useState<string | null>(null);
  const [startActionSuccess, setStartActionSuccess] = useState<string | null>(null);
  const [startParseLoading, setStartParseLoading] = useState(false);

  // hover 状态（第三方案：前景卡片静止；中景气泡根据状态轻微变化）
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

  const [pendingAutoStart, setPendingAutoStart] = useState<{
    mode: InputMode;
    inputValue: string;
    activeSceneId: string | null;
  } | null>(null);

  useEffect(() => {
    const action = consumeWorkspaceStartAction();
    if (!action) return;
    setMode(action.mode);
    setInputValue(action.inputValue);
    setActiveSceneId(action.activeSceneId);
    setPendingAutoStart({
      mode: action.mode,
      inputValue: action.inputValue,
      activeSceneId: action.activeSceneId
    });
    // 清掉一些提示，避免用户误以为上一次状态还在
    setStartActionError(null);
    setStartActionSuccess(null);
  }, []);

  // 测量容器尺寸与 card 中心点（只在 resize / 初次渲染更新，不做帧级计算）
  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      const card = cardRef.current;
      if (!wrap || !card) return;

      const wrapRect = wrap.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();

      // 换算到容器内部坐标系
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

    let rafId: number | null = null;
    const scheduleMeasure = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measure();
      });
    };

    measure();
    const ro = new ResizeObserver(() => scheduleMeasure());
    if (wrapRef.current) ro.observe(wrapRef.current);
    if (cardRef.current) ro.observe(cardRef.current);

    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, scrollOptions);

    return () => {
      ro.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure, scrollOptions);
    };
  }, []);

  const bubbleRender = useMemo(() => {
    // 没有 layout 就先给一个兜底（避免 SSR/首次渲染闪烁）
    const w = layout?.w ?? 1000;
    const h = layout?.h ?? 600;
    const cardCenter = layout?.cardCenter ?? { x: w * 0.5, y: h * 0.5 };

	    return SCENE_BUBBLES.map((b) => {
      const x = b.anchor.x * w;
      const y = b.anchor.y * h;

      // Hover Card：让路偏移（稳定方案：一次性偏移，不做持续力学）
      const avoid = isCardHover ? computeAvoidOffset({ x, y }, cardCenter, 34) : { x: 0, y: 0 };

      // Hover Bubble：单个高亮
      const isHover = hoverBubbleId === b.id;
      const isActive = activeSceneId === b.id;

      // 视觉参数（稳定优雅：默认清晰；hover card 才轻微雾化/变淡）
      const opacity = isCardHover ? (isHover ? 0.88 : 0.72) : isHover ? 0.95 : 0.9;
      const blur = isCardHover ? (isHover ? 0 : 1.5) : 0; // 默认 0，确保“看得见”
      const scale = isHover ? 1.04 : 1;

      // 动画周期：每个气泡不同（但都很慢，且不抖）
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

  const notebookOptions = useMemo(
    () =>
      notebooks.map((nb) => ({
        notebook_id: nb.notebook_id ?? null,
        name: nb.name || '未命名笔记本'
      })),
    [notebooks]
  );
  const linkFieldTemplate = useFieldTemplate({
    source: 'link',
    notebooks: notebookOptions
  });
  const manualFieldTemplate = useFieldTemplate({
    source: 'manual',
    notebooks: notebookOptions
  });
  const activeFieldTemplate = mode === 'link' ? linkFieldTemplate : manualFieldTemplate;

  const {
    linkPrompt: linkAiPrompt,
    textPrompt: textAiPrompt,
    setLinkPrompt: updateLinkAiPrompt,
    setTextPrompt: updateTextAiPrompt
  } = useAiSummaryPrompts();

  const requestNotebookRefresh = useCallback(() => {
    onRequestNotebookRefresh?.();
  }, [onRequestNotebookRefresh]);

  const getCurrentAiSummaryConfig = useCallback((target: InputMode) => {
      const fallback = {
        linkAiSummaryEnabled: true,
        textAiSummaryEnabled: true,
        aiSummaryPrompt: DEFAULT_AI_SUMMARY_PROMPT,
        syncToNotebookTemplate: true
      };
      let parseSettings = fallback;
      try {
        const stored = window.localStorage.getItem(PARSE_SETTINGS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          parseSettings = {
            linkAiSummaryEnabled:
              parsed?.linkAiSummaryEnabled === undefined
                ? parsed?.aiSummaryEnabled === undefined
                  ? true
                  : !!parsed.aiSummaryEnabled
                : !!parsed.linkAiSummaryEnabled,
            textAiSummaryEnabled:
              parsed?.textAiSummaryEnabled === undefined
                ? parsed?.aiSummaryEnabled === undefined
                  ? true
                  : !!parsed.aiSummaryEnabled
                : !!parsed.textAiSummaryEnabled,
            aiSummaryPrompt:
              typeof parsed?.aiSummaryPrompt === 'string' && parsed.aiSummaryPrompt.trim()
                ? parsed.aiSummaryPrompt
                : DEFAULT_AI_SUMMARY_PROMPT,
            syncToNotebookTemplate:
              parsed?.syncToNotebookTemplate === undefined ? true : !!parsed.syncToNotebookTemplate
          };
        }
      } catch {
        // ignore
      }

      if (target === 'link') {
        return {
          enabled: parseSettings.linkAiSummaryEnabled,
          prompt: (parseSettings.aiSummaryPrompt || DEFAULT_AI_SUMMARY_PROMPT).trim() || DEFAULT_AI_SUMMARY_PROMPT,
          syncToNotebookTemplate: parseSettings.syncToNotebookTemplate
        };
      }
      return {
        enabled: parseSettings.textAiSummaryEnabled,
        prompt: readTextPrompt(),
        syncToNotebookTemplate: parseSettings.syncToNotebookTemplate
      };
    }, []);

  const openParseHistoryPanel = useCallback(() => {
    window.dispatchEvent(new CustomEvent(PARSE_HISTORY_EVENTS.open));
  }, []);

  const refreshParseHistory = useCallback(() => {
    window.dispatchEvent(new CustomEvent(PARSE_HISTORY_EVENTS.refresh));
  }, []);

  const notifyParseHistoryCreated = useCallback(
    (historyId?: string | null) => {
      if (historyId) {
        window.dispatchEvent(new CustomEvent(PARSE_HISTORY_EVENTS.created, { detail: { historyId } }));
      } else {
        refreshParseHistory();
      }
    },
    [refreshParseHistory]
  );

  type ParseSuccessPayload = {
    message?: string;
    historyId?: string | null;
    assigned?: boolean;
  };

  const applySuccessState = useCallback(
    (payload: ParseSuccessPayload) => {
      setStartActionSuccess(payload.message || '解析成功');
      setInputValue('');
      setActiveSceneId(null);
      notifyParseHistoryCreated(payload.historyId || null);
      if (payload.assigned) {
        requestNotebookRefresh();
      }
    },
    [notifyParseHistoryCreated, requestNotebookRefresh]
  );

  const applyDraftState = useCallback(
    (historyId?: string | null) => {
      setStartActionSuccess('已存为草稿，已放入解析/分配历史');
      setInputValue('');
      setActiveSceneId(null);
      notifyParseHistoryCreated(historyId || null);
    },
    [notifyParseHistoryCreated]
  );

  const handleStartParse = useCallback(async (override?: { mode?: InputMode; inputValue?: string }) => {
    const currentMode = override?.mode ?? mode;
    const currentInputValue = override?.inputValue ?? inputValue;
    const trimmed = currentInputValue.trim();
    if (!trimmed) {
      setStartActionError(currentMode === 'link' ? '请输入内容后再开始解析' : '请输入内容后再开始 AI 分配');
      setStartActionSuccess(null);
      return;
    }

    // 文本过长时引导进入富文本编辑页（避免在 workspace 输入框里继续操作导致体验混乱）
    if (currentMode === 'text' && trimmed.length > 50) {
      const go = window.confirm('内容超过 50 字，建议进入富文本编辑器继续编辑并保存为笔记。是否前往？');
      if (go) {
        saveQuickNoteDraft(trimmed);
        navigate('/notes');
      }
      return;
    }

    setStartParseLoading(true);
    setStartActionError(null);
    setStartActionSuccess(null);

    const createTimeout = (ms: number, message: string) => {
      let timeoutId: number | null = null;
      const promise = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), ms);
      });
      const cancel = () => {
        if (timeoutId === null) return;
        window.clearTimeout(timeoutId);
        timeoutId = null;
      };
      return { promise, cancel };
    };

    let cancelTimeout = () => {};
    try {
      openParseHistoryPanel();

      if (currentMode === 'link') {
        try {
          new URL(trimmed);
        } catch {
          setStartActionError('请输入有效的URL地址');
          return;
        }

        const existsResp = (await apiClient.post('/api/coze/check-article-exists', {
          articleUrl: trimmed
        })) as { data?: { success?: boolean; exists?: boolean; existingHistoryId?: string | null } };
        if (existsResp?.data?.success && existsResp.data.exists) {
          const existingHistoryId = existsResp.data.existingHistoryId || null;
          setStartActionError('链接已存在，请在解析/分配历史中查看。');
          notifyParseHistoryCreated(existingHistoryId);
          return;
        }

        const apiPromise = apiClient.post('/api/coze/parse-and-assign', {
          articleUrl: trimmed,
          query: '请提取并整理这篇文章的主要内容，保留关键信息和结构。同时根据文章主题推荐一个合适的笔记本分类（如果有）。',
          aiSummaryConfig: getCurrentAiSummaryConfig('link')
        });
        const timeout = createTimeout(
          600000,
          '请求超时，解析可能需要较长时间。请稍后在"解析/分配历史"中查看结果。'
        );
        cancelTimeout = timeout.cancel;
        const response = (await Promise.race([apiPromise, timeout.promise])) as {
          data?: { success?: boolean; data?: ParseSuccessPayload; error?: string };
        };
        if (response?.data?.success) {
          applySuccessState(response.data.data || {});
          return;
        }
        setStartActionError(response?.data?.error || '解析并分配失败，请稍后再试');
        refreshParseHistory();
        return;
      }

      const apiPromise = apiClient.post('/api/parse-and-assign-text', {
        content: trimmed,
        img_urls: [],
        aiSummaryConfig: getCurrentAiSummaryConfig('text')
      });
      const timeout = createTimeout(
        600000,
        '请求超时，解析可能需要较长时间。请稍后在"解析/分配历史"中查看结果。'
      );
      cancelTimeout = timeout.cancel;
      const response = (await Promise.race([apiPromise, timeout.promise])) as {
        data?: { success?: boolean; data?: ParseSuccessPayload; error?: string };
      };
      if (response?.data?.success) {
        applySuccessState(response.data.data || {});
        return;
      }
      setStartActionError(response?.data?.error || '解析并分配失败');
      refreshParseHistory();
    } catch (err: any) {
      console.error('开始解析失败:', err);
      if (err?.message?.includes('超时') || err?.message?.includes('timeout')) {
        setStartActionError('解析超时，可能需要更长时间。请稍后在"解析/分配历史"中查看结果，或稍后重试。');
      } else {
        setStartActionError(err?.response?.data?.error || err?.message || '解析并分配失败');
      }
      refreshParseHistory();
    } finally {
      cancelTimeout();
      setStartParseLoading(false);
    }
  }, [
    applySuccessState,
    getCurrentAiSummaryConfig,
    inputValue,
    mode,
    navigate,
    notifyParseHistoryCreated,
    openParseHistoryPanel,
    refreshParseHistory
  ]);

  useEffect(() => {
    if (!pendingAutoStart) return;
    const action = pendingAutoStart;
    const timer = window.setTimeout(() => {
      handleStartParse({ mode: action.mode, inputValue: action.inputValue });
      // 仅触发一次：等真正开始执行后再清理，避免 effect cleanup 把 timer 清掉导致不执行
      setPendingAutoStart(null);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [pendingAutoStart, handleStartParse]);

  const closeStartMenu = useCallback(() => setStartMenuOpen(false), []);
  const closeModeMenu = useCallback(() => setModeMenuOpen(false), []);

  useOutsideClose(startMenuOpen, '[data-start-menu-root="1"]', closeStartMenu);
  useOutsideClose(modeMenuOpen, '[data-mode-menu-root="1"]', closeModeMenu);

  const handleSaveDraft = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setStartActionError('请输入内容后再存草稿');
      setStartActionSuccess(null);
      setStartMenuOpen(false);
      return;
    }

    setStartActionLoading(true);
    setStartActionError(null);
    setStartActionSuccess(null);
    setStartMenuOpen(false);

    try {
      openParseHistoryPanel();
      if (mode === 'link') {
        // 允许把链接作为“草稿”保存到解析/分配历史（不触发解析与分配）
        // 用 parse-text 复用后端写入解析/分配历史的逻辑
        const response = (await apiClient.post('/api/parse-text', {
          title: '链接草稿',
          content: trimmed,
          structuredFields: {
            link: trimmed,
            draft: true
          },
          aiSummaryConfig: { enabled: false, prompt: '' }
        })) as { data?: { data?: { historyId?: string | null } } };
        const historyId = response?.data?.data?.historyId || null;
        applyDraftState(historyId);
        return;
      }

      // 文本草稿：保存到解析/分配历史（不触发解析与分配）
      const response = (await apiClient.post('/api/parse-text', {
        title: trimmed.split('\n').map((l: string) => l.trim()).find((l: string) => l) || '文本草稿',
        content: trimmed,
        structuredFields: {
          link: 'manual:draft',
          draft: true
        },
        aiSummaryConfig: { enabled: false, prompt: '' }
      })) as { data?: { data?: { historyId?: string | null } } };
      const historyId = response?.data?.data?.historyId || null;
      applyDraftState(historyId);
    } catch (err: any) {
      console.error('存草稿失败:', err);
      setStartActionError(err?.response?.data?.error || err?.message || '存草稿失败');
    } finally {
      setStartActionLoading(false);
    }
  }, [applyDraftState, inputValue, mode, openParseHistoryPanel]);

  const startBusy = startParseLoading || startActionLoading;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#eef6fd] via-[#f3f7ff] to-[#e6fbf7] text-slate-800">
      {/* 页面内联 CSS：仅动效，不依赖外部文件 */}
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
        /* 让路偏移：用外层 translate 控制，内层负责 float 动画，避免 transform 冲突 */
        .bubble-outer { will-change: transform; transition: transform 420ms cubic-bezier(.2,.8,.2,1); }
        .bubble-inner { will-change: transform; }
        /* 可访问性：系统设置减少动画时关闭漂浮 */
        @media (prefers-reduced-motion: reduce) {
          .bubble-float-a, .bubble-float-b, .bubble-float-c { animation: none !important; }
          .bubble-outer { transition: none !important; }
        }
      `}</style>

      {/* Hero 区：三层空间 + 下方解析栏 */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-10">
        <div ref={wrapRef} className="relative w-full max-w-5xl min-h-[300px]">

          {/* Layer 2：中景气泡（慢浮动 + hover 让路，不重叠中心内容） */}
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
                  <span className="flex h-5 w-5 items-center justify-center text-base leading-none">
                    {b.icon}
                  </span>
                  <span className="whitespace-nowrap">{b.label}</span>
                </button>
              </div>
            ))}
          </div>

        {/* Layer 3：前景文案区域（静止，不参与漂浮） */}
        <div className="relative z-20 px-8 pb-20 pt-16 md:px-16 md:pb-24">
          <div
            ref={cardRef}
            onMouseEnter={() => setIsCardHover(true)}
            onMouseLeave={() => setIsCardHover(false)}
            className="mx-auto max-w-3xl text-center"
          >
            <h1 className="text-[56px] font-semibold tracking-[1.5px] text-[#0a223d] md:text-[56px]">
              让内容，更有序
            </h1>

            <p className="mt-3 max-w-2xl mx-auto text-[13px] leading-relaxed text-slate-500 md:text-[14px]">
              支持链接解析、随手记
            </p>
          </div>

        </div>
        </div>

        {/* 卡片下方的解析输入栏（不再贴底） */}
        <div className="mt-8 w-full max-w-4xl space-y-4">
          <div className="flex flex-col gap-3">
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
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleStartParse();
                        }}
                      />
                    </div>
                    <div className="flex items-center">
                      <div className="relative inline-flex flex-1 group" data-start-menu-root="1">
                        {mode === 'text' && (
                          <div className="pointer-events-none absolute -top-10 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                            <div className="rounded-md bg-slate-800 px-2 py-1 text-xs text-white shadow-lg whitespace-nowrap">
                              AI将分配到合适的归属笔记本
                            </div>
                            <div className="h-0 w-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800" />
                          </div>
                        )}
	                        <button
	                          type="button"
	                          onClick={() => handleStartParse()}
	                          disabled={startBusy}
	                          className="inline-flex items-center justify-center gap-2 rounded-l-full bg-gradient-to-r from-[#06c3a8] to-[#43ccb0] px-5 py-2 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(6,195,168,0.32)] hover:brightness-110 transition disabled:opacity-70"
	                        >
                          <span className="text-base">✨</span>
                          <span>
                            {mode === 'link'
                              ? startParseLoading
                                ? '解析中…'
                                : startActionLoading
                                  ? '处理中…'
                                  : '开始解析'
                              : startParseLoading
                                ? 'AI分配中…'
                                : startActionLoading
                                  ? '处理中…'
                                  : 'AI分配'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setStartMenuOpen((v) => !v)}
                          disabled={startBusy}
                          className="inline-flex items-center justify-center rounded-r-full bg-gradient-to-r from-[#06c3a8] to-[#43ccb0] px-3 py-2 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(6,195,168,0.32)] hover:brightness-110 transition disabled:opacity-70"
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

          <div className="flex justify-end text-[12px] text-slate-500">
            <button
              type="button"
              onClick={() => notebookOptions.length && activeFieldTemplate.openModal()}
              disabled={
                !notebookOptions.length ||
                activeFieldTemplate.loading ||
                !activeFieldTemplate.initialized
              }
              className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-[#0a6154] disabled:text-slate-400"
            >
              输出字段设置
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 18l6-6-6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          {(startActionError || startActionSuccess) && (
            <div className="px-2">
              {startActionError && <div className="text-xs text-rose-500">{startActionError}</div>}
              {startActionSuccess && <div className="text-xs text-emerald-600">{startActionSuccess}</div>}
            </div>
          )}
          {activeFieldTemplate.error && (
            <div className="px-2 text-[11px] text-rose-500">{activeFieldTemplate.error}</div>
          )}
        </div>

        {/* 解析/分配历史（完整复刻 AI 导入页能力） */}
        <div className="mt-5 w-full max-w-4xl">
          <ParseHistoryPanel
            notebooks={notebooks}
            onRequestNotebookRefresh={onRequestNotebookRefresh}
          />
        </div>

        <FieldTemplateModal
          isOpen={linkFieldTemplate.isModalOpen}
          sourceType="link"
          notebookName={linkFieldTemplate.currentNotebook?.name || null}
          fields={linkFieldTemplate.modalFields}
          loading={!linkFieldTemplate.initialized || linkFieldTemplate.loading}
          saving={linkFieldTemplate.saving}
          error={linkFieldTemplate.error}
          hasChanges={linkFieldTemplate.hasUnsavedChanges}
          onClose={linkFieldTemplate.closeModal}
          onToggleField={linkFieldTemplate.toggleField}
          onSelectAll={linkFieldTemplate.selectAllFields}
          onClearAll={linkFieldTemplate.clearAllFields}
          onReset={linkFieldTemplate.resetDraftFields}
          onSave={linkFieldTemplate.saveTemplate}
          aiSummaryPrompt={linkAiPrompt}
          onAiSummaryPromptChange={updateLinkAiPrompt}
        />
        <FieldTemplateModal
          isOpen={manualFieldTemplate.isModalOpen}
          sourceType="manual"
          notebookName={manualFieldTemplate.currentNotebook?.name || null}
          fields={manualFieldTemplate.modalFields}
          loading={!manualFieldTemplate.initialized || manualFieldTemplate.loading}
          saving={manualFieldTemplate.saving}
          error={manualFieldTemplate.error}
          hasChanges={manualFieldTemplate.hasUnsavedChanges}
          onClose={manualFieldTemplate.closeModal}
          onToggleField={manualFieldTemplate.toggleField}
          onSelectAll={manualFieldTemplate.selectAllFields}
          onClearAll={manualFieldTemplate.clearAllFields}
          onReset={manualFieldTemplate.resetDraftFields}
          onSave={manualFieldTemplate.saveTemplate}
          aiSummaryPrompt={textAiPrompt}
          onAiSummaryPromptChange={updateTextAiPrompt}
        />
      </main>
    </div>
  );
};

export default CreateWorkspacePage;
