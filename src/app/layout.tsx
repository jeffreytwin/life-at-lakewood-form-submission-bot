import "./globals.css";

export const metadata = {
  title: "Life at Lakewood - Lead Routing Dashboard",
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
