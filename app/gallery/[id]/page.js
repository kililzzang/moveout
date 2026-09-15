import { createServiceClient } from '../../../lib/supabaseServer';
import { buildMediaFromRow } from '../../../lib/postMedia';

// 게시글에서 사진을 탭했을 때 열리는 스와이프 갤러리 페이지 — Supabase Storage
// 원본 파일 한 장만 여는 브라우저 뷰 대신, 이 점검 건의 전체 사진/동영상을 좌우로
// 넘겨볼 수 있게 만들었다(박길일님 요청). 사진 순서는 postToBoard와 똑같이
// lib/postMedia.js를 같이 쓰기 때문에 어긋나지 않는다.
//
// 로그인 여부와 상관없이 누구나 볼 수 있게 열어뒀다(proxy.js에서 /gallery 예외 처리) —
// 어차피 사진 원본 URL 자체가 Supabase의 public 버킷이라 이미 로그인 없이 열람
// 가능했고, 이 페이지는 그 사진들을 더 보기 편하게 모아서 보여주는 것뿐이라 굳이
// 로그인을 강제할 이유가 없다.
export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return { title: '점검 사진' };
}

export default async function GalleryPage({ params }) {
  const { id } = await params;
  const supabase = createServiceClient();
  const { data: row } = await supabase.from('post_queue').select('*').eq('id', id).maybeSingle();

  if (!row) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: 24, color: '#fff' }}>
          사진을 찾을 수 없어요. 링크가 잘못됐거나 삭제된 점검 기록이에요.
        </div>
      </div>
    );
  }

  const media = buildMediaFromRow(row);
  const heading = [row.building, row.unit ? row.unit + '호' : ''].filter(Boolean).join(' ');

  if (!media.length) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: 24, color: '#fff' }}>{heading || '이 점검 건'}에 등록된 사진/동영상이 없어요.</div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        {heading || '점검 사진'}{row.date ? ' · ' + row.date : ''}
      </div>
      <div id="gallery-scroller" style={scrollerStyle}>
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
              <div style={captionStyle}>
                {idx + 1} / {media.length}{m.label ? ' · ' + m.label : ''}
              </div>
            </div>
          );
        })}
      </div>
      {/* 가로 스크롤 컨테이너 안의 요소는 브라우저마다 URL 프래그먼트(#p3) 이동이
          기본으로 안 먹히는 경우가 있어서, 로드 시 직접 한 번 더 스크롤 위치를 맞춘다. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "(function(){var h=window.location.hash;if(!h)return;var el=document.getElementById(h.slice(1));" +
            "if(el)el.scrollIntoView({inline:'start',block:'nearest'});})();",
        }}
      />
    </div>
  );
}

const pageStyle = { background: '#0b0b0c', minHeight: '100dvh' };
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
  flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: '48px 12px 24px', boxSizing: 'border-box',
};
const mediaStyle = { maxWidth: '100%', maxHeight: '78dvh', objectFit: 'contain' };
const captionStyle = { color: '#fff', fontSize: 13, marginTop: 10, textAlign: 'center' };
