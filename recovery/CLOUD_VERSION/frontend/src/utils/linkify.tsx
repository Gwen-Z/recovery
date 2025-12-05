import React from 'react';

// 简单识别 http/https 链接并加上 <a> 包裹，其余文本原样输出
const urlRegex =
  /((https?:\/\/)[^\s/$.?#].[^\s]*)/gi;

export const renderContentWithLinks = (text: string): React.ReactNode => {
  if (!text) return null;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    const [url] = match;
    const start = match.index;

    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    parts.push(
      <a
        key={`${url}-${start}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-purple-600 underline underline-offset-2 break-all"
      >
        {url}
      </a>
    );

    lastIndex = start + url.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
};


