import { NextResponse } from 'next/server';

// 2026-09-16: 이 크론(매일 새벽 2시 실행)이 실제로 큰 문제를 일으키고 있던 걸
// 뒤늦게 발견해서 껐다(vercel.json의 crons도 같이 비움) — 박길일님께 명시적으로
// 확인받은 결정이다.
//
// 원래 하던 일: post_queue.status가 'posted'로 바뀐 지 1일(GRACE_DAYS) 지난
// 점검 기록의 사진(Storage)·inspections 행·post_queue 행을 전부 삭제.
// Supabase 무료 플랜 용량(DB 500MB, 파일 저장소 1GB)을 아끼려는 목적이었다.
//
// 왜 문제였나:
// 1) "이전호실점검내역" 기능(lib/history.js fetchLatestHistoryEntry)이 inspections
//    표의 최신 기록을 찾아서 보여주는데, 이 크론이 게시 다음날 그 기록을 지워버려서
//    항상 옛날 정적 스냅샷(unit_history)으로만 돌아가고 있었다 — "이전호실점검내역이
//    최신 데이터를 안 보여준다"는 증상의 원인이 바로 이것.
// 2) 네이버웍스 게시글의 사진/동영상은 파일을 복사해서 올리는 게 아니라 Supabase
//    Storage의 공개 URL을 <img>/<video> 태그로 그대로 링크(hotlink)한 것이다.
//    그래서 이 크론이 파일을 지우면 "이미 게시된 글의 사진이 다음날부터 깨져서
//    안 보이게" 된다 — "사진이 무조건 인라인으로 들어가야 한다"던 요구사항과
//    정면 충돌.
//
// 지금 결정: inspections·Storage 사진 둘 다 삭제하지 않고 영구 보관한다. 저장
// 용량이 실제로 부족해지면(Supabase Storage 무료 1GB) 그때 가서 Cloudflare R2 같은
// 더 큰 무료 저장소로 옮기는 방안을 별도로 설계하기로 했다 — 지금 당장 삭제로
// 해결할 문제는 아니라고 판단.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ disabled: true, reason: '2026-09-16부터 자동삭제 중단(이 파일 상단 주석 참고)' });
}
