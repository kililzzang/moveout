// post_queue 행(row)에서 게시글에 들어갈 사진/동영상 순서를 조립한다. 원래
// app/api/naverworks/post/route.js 안에 있던 로직을 그대로 뽑아냈다 — 실제 게시
// (postToBoard)와 스와이프 갤러리 페이지(app/gallery/[id]) 둘 다 정확히 같은 순서를
// 써야, 게시글 사진을 탭했을 때 갤러리의 같은 사진 위치(#p{idx})로 넘어간다.
//
// v1(점검결과표)·v2(하자요약표)는 isTable:true로 표시한다 — 실제 촬영 사진과 달리
// 표/글자가 담긴 이미지라 화면 표시 크기를 줄이면 안 읽혀서, 이 항목만 축소하지
// 않는다(박길일님 요청).
//
// group은 postToBoard가 "내부사진"/"하자사진" 구분선을 어디에 넣을지 판단하는 데
// 쓴다(박길일님 요청) — 'table'(점검결과표·하자요약표)은 구분선 대상이 아니고,
// 'general'(일반/내부 촬영 사진)로 바뀌는 지점과 'defect'(하자사진)로 바뀌는
// 지점에서만 한 번씩 구분선이 들어간다.
export function buildMediaFromRow(row) {
  const media = [];
  if (row.v1_image_url) {
    media.push({ label: '점검결과표', url: row.v1_image_url, contentType: 'image/png', isTable: true, group: 'table' });
  }
  (row.general_photos || []).forEach((p) => {
    if (p?.url) media.push({ label: p.label || '사진', url: p.url, contentType: p.contentType, group: 'general' });
  });
  if (row.v2_image_url) {
    media.push({ label: '하자요약표', url: row.v2_image_url, contentType: 'image/png', isTable: true, group: 'table' });
  }
  (row.defects || []).forEach((d) => {
    (d.photos || []).forEach((p) => {
      if (p?.url) {
        media.push({
          label: `${d.mark || ''} ${d.caption || d.label || ''}`.trim(),
          url: p.url,
          contentType: p.contentType,
          group: 'defect',
        });
      }
    });
  });
  return media;
}
