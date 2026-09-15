import './globals.css';

export const metadata = {
  title: '퇴실점검 클립보드',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
