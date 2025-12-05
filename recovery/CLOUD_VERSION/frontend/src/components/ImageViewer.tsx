import React, { useEffect, useState, useCallback } from 'react';

interface ImageViewerProps {
  images: string[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (newIndex: number) => void;
}

const ImageViewer: React.FC<ImageViewerProps> = ({
  images,
  currentIndex,
  isOpen,
  onClose,
  onNavigate
}) => {
  const [imageIndex, setImageIndex] = useState(currentIndex);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [error, setError] = useState(false);

  // 当外部 currentIndex 变化时，更新内部索引
  useEffect(() => {
    setImageIndex(currentIndex);
    setImageLoaded(false);
    setError(false);
  }, [currentIndex, isOpen]);

  // 导航到上一张
  const handlePrevious = useCallback(() => {
    if (images.length === 0) return;
    const newIndex = imageIndex > 0 ? imageIndex - 1 : images.length - 1;
    setImageIndex(newIndex);
    setImageLoaded(false);
    setError(false);
    if (onNavigate) {
      onNavigate(newIndex);
    }
  }, [imageIndex, images.length, onNavigate]);

  // 导航到下一张
  const handleNext = useCallback(() => {
    if (images.length === 0) return;
    const newIndex = imageIndex < images.length - 1 ? imageIndex + 1 : 0;
    setImageIndex(newIndex);
    setImageLoaded(false);
    setError(false);
    if (onNavigate) {
      onNavigate(newIndex);
    }
  }, [imageIndex, images.length, onNavigate]);

  // 键盘事件处理
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrevious();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handlePrevious, handleNext, onClose]);

  // 阻止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen || images.length === 0 || imageIndex < 0 || imageIndex >= images.length) {
    return null;
  }

  const currentImage = images[imageIndex];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90"
      onClick={onClose}
      style={{ cursor: 'pointer' }}
    >
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        style={{ cursor: 'pointer' }}
        aria-label="关闭"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      {/* 上一张按钮 */}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handlePrevious();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          style={{ cursor: 'pointer' }}
          aria-label="上一张"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      )}

      {/* 下一张按钮 */}
      {images.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleNext();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          style={{ cursor: 'pointer' }}
          aria-label="下一张"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      )}

      {/* 图片计数器 */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-black/50 text-white text-sm">
          {imageIndex + 1} / {images.length}
        </div>
      )}

      {/* 图片容器 */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        style={{ cursor: 'default' }}
      >
        {error ? (
          <div className="text-white text-center">
            <p className="text-lg mb-2">图片加载失败</p>
            <p className="text-sm text-gray-400">请检查图片链接是否正确</p>
          </div>
        ) : (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-white text-lg">加载中...</div>
              </div>
            )}
            <img
              src={currentImage}
              alt={`图片 ${imageIndex + 1}`}
              className="max-w-full max-h-[90vh] object-contain"
              style={{
                opacity: imageLoaded ? 1 : 0,
                transition: 'opacity 0.3s ease-in-out'
              }}
              onLoad={() => setImageLoaded(true)}
              onError={() => {
                setError(true);
                setImageLoaded(true);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default ImageViewer;
