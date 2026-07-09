export const metadata = { title: "Offline — Clements Inventory" };

export default function OfflinePage() {
  return (
    <div className="min-h-screen grid place-items-center p-6 text-center">
      <div>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white text-xl font-bold">
          C
        </div>
        <h1 className="text-lg font-semibold text-ink">You&rsquo;re offline</h1>
        <p className="mt-1 text-sm text-muted max-w-xs">
          Clements Inventory needs a connection to load live stock data.
          Reconnect and try again.
        </p>
      </div>
    </div>
  );
}
