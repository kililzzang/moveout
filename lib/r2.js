// Cloudflare R2 저장소 헬퍼(서버 전용) — 2026-09-16, Supabase Storage 무료 용량(1GB)이
// 점검이 쌓이면 금방 찰 거라는 우려로 R2(무료 10GB, egress 무료)로 옮기기로 했다.
// R2는 S3 호환 API라 AWS SDK(@aws-sdk/client-s3)를 그대로 쓸 수 있다.
//
// 브라우저가 파일을 직접 R2로 올리는 방식(지금 Supabase와 동일한 UX)을 유지하려고,
// 서버(app/api/r2/presign)가 "이 경로에 이 파일을 올려도 된다"는 서명된 업로드 URL
// (presigned PUT URL)을 짧은 시간만 발급해준다 — 진짜 인증키(Access/Secret Key)는
// 서버 환경변수에만 있고 브라우저로는 절대 안 나간다.
import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const R2_BUCKET = process.env.R2_BUCKET_NAME || 'moveout-photos';

// 공개 URL(R2 "공개 개발 URL" — Vercel 환경변수 R2_BUCKET_PUBLIC_URL)에 경로만
// 붙이면 실제 게시글/화면에서 바로 쓸 수 있는 최종 URL이 된다.
export function getR2PublicUrl(path) {
  const base = (process.env.R2_BUCKET_PUBLIC_URL || '').replace(/\/+$/, '');
  return `${base}/${path}`;
}

export function createR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

// 5분짜리 업로드 전용 서명 URL 하나 발급 — 브라우저가 이 URL로 PUT 요청 한 번만
// 보내면 업로드가 끝난다(멀티파트 아님, 최대 50MB 정도까지는 이 방식으로 충분).
export async function presignPutUrl(path, contentType) {
  const client = createR2Client();
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: path,
    ContentType: contentType || 'application/octet-stream',
  });
  return getSignedUrl(client, command, { expiresIn: 300 });
}

export async function deleteR2Object(path) {
  const client = createR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: path }));
}
