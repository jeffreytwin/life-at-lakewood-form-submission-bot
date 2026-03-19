import "./globals.css";

export const metadata = {
  title: "Life At Lakewood - Frontlines Hub",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
