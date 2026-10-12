import { dateTime } from "../../format.ts";
import { LEVEL, S } from "./ops-strings.ts";
import type { OpsSnapshot } from "./types.ts";

export function DoctorList({ doctor, disabled, onRun }: { doctor: OpsSnapshot["doctor"]; disabled: boolean; onRun: () => void }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{S.doctor}</h2>
          <div className="card-sub">{doctor ? `Viimeksi ${dateTime(doctor.at)}` : "–"}</div>
        </div>
        <button className="btn" type="button" disabled={disabled} onClick={onRun}>
          {S.runDoctor}
        </button>
      </div>
      {doctor && (
        <ul className="ops-doctor">
          {doctor.items.map((i) => (
            <li key={i.id || i.title}>
              <span className={`badge ${i.level === "ok" ? "good" : i.level === "warn" ? "warn" : "bad"}`} style={{ marginLeft: 0 }}>{LEVEL[i.level]}</span> <strong>{i.title}</strong>
              {i.detail && <div className="small muted">{i.detail}</div>}
              {i.hint && i.level !== "ok" && <div className="small">{i.hint}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
