'use client';

/** Last-resort boundary (replaces the root layout, so it brings its own <html>). */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <main
          data-page-state="error"
          style={{
            minHeight: '100dvh',
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div>
            <h1 style={{ fontSize: 24 }}>Something went wrong</h1>
            <p style={{ color: '#475569' }}>Please try again in a moment.</p>
            {error.digest ? (
              <p style={{ fontFamily: 'monospace', fontSize: 12 }}>Reference: {error.digest}</p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 12,
                padding: '10px 16px',
                borderRadius: 8,
                border: 0,
                background: '#0B6E4F',
                color: '#fff',
                fontWeight: 600,
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
