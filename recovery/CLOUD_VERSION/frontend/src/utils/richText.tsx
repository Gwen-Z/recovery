import React from 'react';
import { renderContentWithLinks } from './linkify';

/**
 * 简单的富文本渲染：
 * - 按换行拆分段落
 * - 保留基本文本与链接高亮
 */
export const renderRichText = (content: string): React.ReactNode => {
  if (!content) return null;

  const paragraphs = content.split(/\n+/).map((p) => p.trim()).filter(Boolean);

  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="mb-2 last:mb-0">
          {renderContentWithLinks(paragraph)}
        </p>
      ))}
    </>
  );
};


