import { createServiceClient } from '../../../lib/supabaseServer';
import { buildMediaFromRow } from '../../../lib/postMedia';
import Gallery from './Gallery';

// 게시글에서 사진을 탭했을 때 열리는 스와이프 갤러리 페이지 — Supabase Storage
// 원본 파일 한 장만 여는 브라우저 뷰 대신, 이 점검 건의 전체 사진/동영상을 좌우로
// 넘겨볼 수 있게 만들었다(박길일님 요청). 사진 순서는 postToBoard와 똑같이
// lib/postMedia.js를 같이 쓰기 때문에 어긋나지 않는다.
//
// 로그인 여부와 상관없이 누구나 볼 수 있게 열어뒀다(proxy.js에서 /gallery 예외 처리) —
// 어차피 사진 원본 URL 자체가 Supabase의 public 버킷이라 이미 로그인 없이 열람
// 가능했고, 이 페이지는 그 사진들을 더 보기 편하게 모아서 보여주는 것뿐이라 굳이
// 로그인을 강제할 이유가 없다.
//
// 실제 스와이프·좌우 버튼 조작은 클라이언트 상태(현재 위치 등)가 필요해서 Gallery.jsx
// ('use client')로 뺐다 — 이 파일은 서버에서 데이터만 조회해서 넘겨준다.
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
  const heading = [row.building, row.unit ? row.unit + '호' : ''].filter(Boolean).join(' ')
    + (row.date ? ' · ' + row.date : '');

  if (!media.length) {
    return (
      <div style={pageStyle}>
        <div style={{ padding: 24, color: '#fff' }}>{heading || '이 점검 건'}에 등록된 사진/동영상이 없어요.</div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <Gallery media={media} heading={heading || '점검 사진'} />
    </div>
  );
}

const pageStyle = { background: '#0b0b0c', minHeight: '100dvh' };
