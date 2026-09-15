// 1회성 데이터 이전 스크립트 — lib/unitHistory.json(예전 아티팩트의 UNIT_HISTORY 942건)을
// Supabase unit_history 테이블에 채워 넣는다.
//
// 실행 전:
//   1. supabase/schema.sql 을 Supabase 대시보드 SQL Editor에서 먼저 실행해서 테이블을 만든다
//   2. 이 프로젝트 루트에 .env.local 을 만들고(.env.local.example 참고) 실제 값을 채운다
//   3. npm install 로 @supabase/supabase-js 를 받는다
//
// 실행: node -r dotenv/config scripts/import-unit-history.js dotenv_config_path=.env.local
// (또는 환경변수를 직접 export 해서 실행해도 됨)
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey);
const records = JSON.parse(fs.readFileSync(__dirname + '/../lib/unitHistory.json', 'utf8'));

async function main() {
  const BATCH = 200;
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH);
    const { error } = await supabase.from('unit_history').insert(chunk);
    if (error) { console.error('배치 ' + i + ' 실패:', error.message); process.exit(1); }
    console.log('imported', i + chunk.length, '/', records.length);
  }
  console.log('완료');
}
main();
