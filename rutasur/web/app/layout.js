import './globals.css';
import Link from 'next/link';

export const metadata = { title: 'RutaSur · Torre de control', description: 'Seguimiento de envios en tiempo real' };

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <header className="barra">
          <strong>RutaSur</strong>
          <nav>
            <Link href="/">Torre de control</Link>
            <Link href="/analitica">Analítica</Link>
            <Link href="/demo">Panel de demo</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
