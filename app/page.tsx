import Link from 'next/link';

export default function Home() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/">
            <svg className="pin" viewBox="0 0 24 24" fill="#e2640f" aria-hidden>
              <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" />
              <circle cx="12" cy="9" r="2.6" fill="#fff" />
            </svg>
            <span>
              <b>McCarthy Tyre Services</b>
              <small>Technician GPS Tracking</small>
            </span>
          </Link>
        </div>
      </header>

      <main className="home">
        <p className="eyebrow">Live tracking</p>
        <h1>Technician GPS Tracking</h1>
        <p className="lead">
          Track field technicians live on a map, keep recording through dead zones, and
          measure distance per job — all from the phone&rsquo;s browser.
        </p>

        <div className="cards">
          <Link className="card" href="/track">
            <div className="ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" />
                <circle cx="12" cy="9" r="2.6" />
              </svg>
            </div>
            <h3>Technician tracker →</h3>
            <p>Open this on the driver&rsquo;s phone. Start a trip and it shares location while on shift.</p>
          </Link>

          <Link className="card" href="/dispatch">
            <div className="ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
            </div>
            <h3>Dispatch console →</h3>
            <p>Open this on the desk. See every active technician live on the map.</p>
          </Link>
        </div>

        <p className="note" style={{ marginTop: 30 }}>
          Tip: the technician page needs HTTPS to read location — it works on your deployed
          Vercel URL, and on <code>localhost</code> during development.
        </p>
      </main>
    </>
  );
}
