'use client';
import { useEffect, useRef, useState } from 'react';

// 2026-09-15: 스와이프(터치 드래그)만으로는 PC에서 보거나 손이 불편할 때 넘기기
// 어렵다는 요청(박길일님) — 좌우 화살표 버튼을 추가했다. 스와이프 자체는 CSS
// scroll-snap이 그대로 처리하고, 버튼은 scrollTo로 한 칸씩 이동만 거들 뿐이라
// 서로 충돌하지 않는다. 현재 위치(index)는 스크롤 이벤트로 계속 갱신해서, 스와이프로
// 넘겨도 버튼 활성화 상태·"n / 전체" 표시가 같이 맞는다.
export default function Gallery({ media, heading }) {
  const scrollerRef = useRef(null);
  const [index, setIndex] = useState(0);
  const scrollingByButton = useRef(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const hash = window.location.hash;
    let start = 0;
    if (hash && hash.indexOf('#p') === 0) {
      const n = parseInt(hash.slice(2), 10);
      if (!isNaN(n) && n >= 0 && n < media.length) start = n;
    }
    el.scrollTo({ left: start * el.clientWidth, behavior: 'auto' });
    setIndex(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goTo(i) {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(media.length - 1, i));
    scrollingByButton.current = true;
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
    setIndex(clamped);
    window.history.replaceState(null, '', '#p' + clamped);
    setTimeout(() => { scrollingByButton.current = false; }, 400);
  }

  function handleScroll() {
    if (scrollingByButton.current) return;
    const el = scrollerRef.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setIndex((prev) => (prev === i ? prev : i));
  }

  const current = media[index];

  return (
    <>
      <div style={headerStyle}>{heading}</div>

      <div ref={scrollerRef} onScroll={handleScroll} style={scrollerStyle}>
        {media.map((m, idx) => {
          const isVideo = (m.contentType || '').indexOf('video') === 0;
          return (
            <div key={idx} id={'p' + idx} style={slideStyle}>
              {isVideo ? (
                <video src={m.url} controls style={mediaStyle} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.label || ''} style={mediaStyle} />
              )}
            </div>
          );
        })}
      </div>

      <div style={navBarStyle}>
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0} style={navBtnStyle(index === 0)}>
          ‹
        </button>
        <div style={captionStyle}>
          {index + 1} / {media.length}{current && current.label ? ' · ' + current.label : ''}
        </div>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          disabled={index === media.length - 1}
          style={navBtnStyle(index === media.length - 1)}
        >
          ›
        </button>
      </div>
    </>
  );
}

const headerStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1,
  padding: '10px 16px', color: '#fff', fontSize: 13,
  background: 'linear-gradient(180deg, rgba(0,0,0,.55), rgba(0,0,0,0))',
};
const scrollerStyle = {
  display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory',
  WebkitOverflowScrolling: 'touch', height: '100dvh',
};
const slideStyle = {
  flex: '0 0 100%', scrollSnapAlign: 'start', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  padding: '48px 12px 74px', boxSizing: 'border-box',
};
const mediaStyle = { maxWidth: '100%', maxHeight: '78dvh', objectFit: 'contain' };
const navBarStyle = {
  position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 10, padding: '10px 14px', boxSizing: 'border-box',
  background: 'linear-gradient(0deg, rgba(0,0,0,.6), rgba(0,0,0,0))',
};
const captionStyle = { flex: 1, color: '#fff', fontSize: 13, textAlign: 'center' };
function navBtnStyle(disabled) {
  return {
    width: 44, height: 44, borderRadius: '50%', border: 'none',
    background: disabled ? 'rgba(255,255,255,.15)' : 'rgba(255,255,255,.9)',
    color: disabled ? 'rgba(255,255,255,.5)' : '#111', fontSize: 22, lineHeight: 1,
    cursor: disabled ? 'default' : 'pointer', flexShrink: 0,
  };
}
