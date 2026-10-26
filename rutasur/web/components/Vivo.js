'use client';
export default function Vivo({ conectado }) {
  return <span className={`vivo ${conectado ? 'on' : 'off'}`}>{conectado ? '● En vivo' : '○ Reconectando…'}</span>;
}
