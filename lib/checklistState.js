// 체크리스트의 핵심 상태 구조 — moveout-checklist.html의 defaultState/loadState/save를
// 그대로 옮긴 것. localStorage에 이 기기의 임시 작업 내용을 저장해서 새로고침해도
// 안 날아가게 하고(Supabase 저장은 "리포트 저장·복사"를 눌렀을 때만 일어남), 공유
// 저장소 동기화는 이 파일이 아니라 컴포넌트에서 Supabase 클라이언트로 직접 한다.
import { SECTIONS } from './sections';

export const STORAGE_KEY = 'moveout-checklist-v7';

export const INFO_FIELDS = [
  { id: 'building', label: '건물명', type: 'text' },
  { id: 'jibunAddress', label: '지번주소', type: 'text' },
  { id: 'unit', label: '호실', type: 'text' },
  { id: 'date', label: '점검일', type: 'date' },
  { id: 'checkTime', label: '현장체크 시간', type: 'time' },
  { id: 'passcode', label: '세대비번', type: 'text' },
  { id: 'inspector', label: '담당자', type: 'text' },
  { id: 'parkingRemote', label: '주차리모컨', type: 'text' },
  { id: 'cleaningFee', label: '청소 추가금액', type: 'number' },
];

export const KNOWN_BUILDINGS = [
  '가이아프레지던스', '아라트라움', '아라트라움아리스타', '서정스마트빌듀오2차',
  '대양아리스타2차', '힐탑더테라스', '서정스마트빌듀오3차', '화신노블레스1차',
  '서정벨루스하임', '클래시아', '서정스마트빌듀오1차', '힐탑포레스트', '두드림', '대양1차',
];

export function defaultState() {
  const info = {};
  INFO_FIELDS.forEach((f) => { info[f.id] = ''; });
  const items = {};
  SECTIONS.forEach((sec) => {
    sec.items.forEach((it, idx) => {
      items[sec.id + ':' + idx] = {
        status: '', note: '', amount: '', noteOpen: false,
        responsibility: '', depYears: '', photos: [],
      };
    });
  });
  const open = {}; open[SECTIONS[0].id] = true;
  const custom = {}; SECTIONS.forEach((sec) => { custom[sec.id] = []; });
  return { info, items, open, custom, finalNote: '' };
}

export function loadState() {
  if (typeof window === 'undefined') return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const d = defaultState();
    d.info = Object.assign(d.info, parsed.info || {});
    d.items = Object.assign(d.items, parsed.items || {});
    d.open = parsed.open || d.open;
    if (parsed.custom) {
      Object.keys(parsed.custom).forEach((k) => {
        if (d.custom[k]) d.custom[k] = parsed.custom[k];
      });
    }
    d.finalNote = parsed.finalNote || '';
    return d;
  } catch (e) { return defaultState(); }
}

export function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

// db 문서ID는 영문/숫자/일부 기호만 허용 — 한글이 섞인 건물_호실을 안정적인 해시로
// 바꿔 ASCII 전용 ID를 만든다(moveout-checklist.html과 동일한 규칙 — 실제 "저장 실패"
// 버그를 고치며 만들어진 함수, 그대로 옮김. 같은 건물_호실이면 항상 같은 ID가 나와야
// "그 호실의 최신 기록 1개로 덮어쓰기"가 앱 사이에서도 계속 성립한다).
export function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) { h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; }
  return h.toString(36);
}

export function sanitizeUnitKey(raw) {
  const ascii = raw.replace(/[^A-Za-z0-9_\-.~:@+]/g, '');
  return (ascii || 'u') + '-' + stableHash(raw);
}

export function unitDocId(state) {
  const b = (state.info.building || '').trim();
  const u = (state.info.unit || '').trim();
  if (!b && !u) return 'untitled-' + Date.now();
  return sanitizeUnitKey(b + '_' + u).slice(0, 200);
}

export function uid() {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
