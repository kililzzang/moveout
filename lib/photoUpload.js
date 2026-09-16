// 2026-09-16 신설 — 하자보수/청소 클립보드의 "완료사진" 업로드(박길일님 요청 ②).
// ChecklistApp.jsx의 uploadPhoto와 같은 방식(Storage 'photos' 버킷, 이미지면 리사이즈
// 후 업로드)을 work_orders 항목 단위로 재사용할 수 있게 뽑아냈다.
const MAX_PHOTO_MB = 50;
const IMAGE_MAX_DIM = 1600;

function compressImageIfNeeded(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return Promise.resolve(file);
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(img.width, img.height));
      if (scale >= 1) { resolve(file); return; }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file);
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// orderId 아래 completion/ 폴더에 저장 — 점검 사진(docId 바로 아래)과 구분해서
// 나중에 "이 작업의 완료사진만" 찾기 쉽게 한다.
export async function uploadCompletionPhoto(supabase, orderId, file) {
  const processed = await compressImageIfNeeded(file);
  if (processed.size > MAX_PHOTO_MB * 1024 * 1024) {
    throw new Error(`${file.name} 용량이 ${MAX_PHOTO_MB}MB를 넘어요.`);
  }
  const safeName = file.name.replace(/[^A-Za-z0-9_.\-]/g, '_');
  const path = `${orderId}/completion/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('photos').upload(path, processed);
  if (error) throw error;
  const { data } = supabase.storage.from('photos').getPublicUrl(path);
  return data.publicUrl;
}
