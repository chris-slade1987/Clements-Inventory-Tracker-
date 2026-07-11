export const metadata = { title: "Offline — Clements Command & Control" };

export default function OfflinePage() {
  return (
    <div className="min-h-screen grid place-items-center p-6 text-center bg-forest-grad">
      <div>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-grad text-[#05271c] text-xl font-semibold">
          C
        </div>
        <h1 className="text-lg font-light text-white">You&rsquo;re offline</h1>
        <p className="mt-1 text-sm text-mint max-w-xs">
          Clements Command &amp; Control needs a connection to load live data.
          Reconnect and try again.
        </p>
      </div>
    </div>
  );
}
