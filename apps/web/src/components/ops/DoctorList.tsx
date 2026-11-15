import { dateTime } from "../../format.ts";
import { LEVEL, S } from "./ops-strings.ts";
import type { OpsSnapshot } from "./types.ts";

/** The findings of the last status run, with when it ran. The button that runs it is in the servicing list (ToolsPanel). */
export function DoctorList({ doctor, stale = false }: { doctor: OpsSnapshot["doctor"]; stale?: boolean }) {
  if (!doctor) return null;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{S.doctor}</h2>
          <div className="card-sub">{S.checkedAt(dateTime(doctor.at))}</div>
          {stale && <div className="card-sub ops-last warning">{S.doctorStale}</div>}
        </div>
      </div>
      <ul className="ops-doctor">
        {doctor.items.map((i) => (
          <li key={i.id || i.title}>
            <span className={`badge flush ${i.level === "ok" ? "good" : i.level === "warn" ? "warn" : "bad"}`}>{LEVEL[i.level]}</span> <strong>{i.title}</strong>
            {i.detail && <div className="small muted">{i.detail}</div>}
            {i.hint && i.level !== "ok" && <div className="small">{i.hint}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
