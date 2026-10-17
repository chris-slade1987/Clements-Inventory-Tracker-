import TryAgain from "./TryAgain";

export const metadata = { title: "Offline — CanopyOS" };

export default function OfflinePage() {
  return (
    <div className="min-h-screen grid place-items-center p-6 text-center bg-forest-grad">
      <div className="flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/canopyos-wordmark.png" alt="CanopyOS" className="h-9 w-auto" />
        <h1 className="mt-6 text-lg font-light text-white">You&rsquo;re offline</h1>
        <p className="mt-1 text-sm text-mint max-w-xs">
          CanopyOS needs a connection to load live data. Reconnect, then try again.
        </p>
        <div className="mt-5">
          <TryAgain />
        </div>
      </div>
    </div>
  );
}
