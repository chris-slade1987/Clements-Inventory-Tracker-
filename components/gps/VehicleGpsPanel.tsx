import Link from "next/link";
import { Card } from "@/components/ui";
import { positionsFor, tripsFor } from "@/lib/gps";
import { STATUS_META, lastSeen, type GpsStatus } from "@/lib/gps-ui";
import FleetMap from "@/components/gps/FleetMap";

// Per-vehicle GPS panel: a mini-map of the latest position + last-24h trail,
// last-seen / speed / ignition / odometer, and today's trips. Server component —
// reads the local GPS store (fed by sync). Shows nothing but a hint when the
// vehicle has no positions yet.

const OFFLINE_HOURS = 6;
const MOVING_SPEED = 3;

function classify(ts: Date, speed: number | null, ignition: boolean | null): GpsStatus {
  if (Date.now() - ts.getTime() > OFFLINE_HOURS * 3600 * 1000) return "offline";
  if ((speed ?? 0) > MOVING_SPEED) return "moving";
  if (ignition === true) return "idle";
  return "stopped";
}

export default async function VehicleGpsPanel({ vehicleId }: { vehicleId: string }) {
  const [trail, trips] = await Promise.all([positionsFor(vehicleId, 24), tripsFor(vehicleId)]);
  const latest = trail.length ? trail[trail.length - 1] : null;

  return (
    <Card className="p-0 overflow-hidden mb-5" data-testid="vehicle-gps">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-ink">
          GPS / Location
          {latest?.sample ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Sample data</span>
          ) : null}
        </div>
        <Link href="/fleet/map" className="text-xs font-medium text-brand-700 hover:underline">View on live map →</Link>
      </div>

      {!latest ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          No GPS positions recorded for this vehicle yet. An admin can sync from the Live Map.
        </p>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <FleetMap
              height={300}
              markers={[
                {
                  id: vehicleId,
                  lat: latest.lat,
                  lng: latest.lng,
                  label: "Latest position",
                  color: STATUS_META[classify(latest.ts, latest.speed, latest.ignition)].color,
                  lines: [
                    `Seen ${lastSeen(latest.ts)}`,
                    ...(latest.address ? [latest.address] : []),
                  ],
                },
              ]}
              trail={trail.map((t) => [t.lat, t.lng] as [number, number])}
            />
          </div>

          <div className="space-y-3">
            <dl className="space-y-1.5 text-sm">
              <Row label="Status" value={STATUS_META[classify(latest.ts, latest.speed, latest.ignition)].label} />
              <Row label="Last seen" value={lastSeen(latest.ts)} />
              <Row label="Speed" value={latest.speed != null ? `${Math.round(latest.speed)} mph` : "—"} />
              <Row label="Ignition" value={latest.ignition == null ? "—" : latest.ignition ? "On" : "Off"} />
              <Row label="Odometer" value={latest.odometer != null ? `${Math.round(latest.odometer).toLocaleString()} mi` : "—"} />
              <Row label="Address" value={latest.address ?? "—"} />
            </dl>

            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted mb-1">Today&apos;s trips</div>
              {trips.length === 0 ? (
                <p className="text-xs text-muted">No trips recorded today.</p>
              ) : (
                <ul className="space-y-1">
                  {trips.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${t.kind === "journey" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                          {t.kind === "journey" ? "Trip" : t.kind === "stop" ? "Stop" : t.kind}
                        </span>
                        <span className="text-muted">
                          {t.startTs ? new Date(t.startTs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}
                          {t.endTs ? `–${new Date(t.endTs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
                        </span>
                      </span>
                      {t.distanceMi != null && t.distanceMi > 0 ? (
                        <span className="tabular-nums text-muted">{t.distanceMi.toFixed(1)} mi</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink text-right">{value}</dd>
    </div>
  );
}
