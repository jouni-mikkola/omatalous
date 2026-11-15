import { dateTime } from "../../format.ts";
import { LEVEL, S } from "./ops-strings.ts";
import { LastResult } from "./LastResult.tsx";
import type { OpsRequestView, OpsSnapshot } from "./types.ts";
import { Button } from "../ui/Button.tsx";
export function DoctorList({ doctor, last, disabled, onRun }: { doctor: OpsSnapshot["doctor"]; last: OpsRequestView | undefined; disabled: boolean; onRun: () => void }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{S.doctor}</h2>
          <LastResult request={last} />
          {doctor && <div className="card-sub">{S.checkedAt(dateTime(doctor.at))}</div>}
        </div>
        <Button disabled={disabled} onClick={onRun}>
          {S.runDoctor}
        </Button>
      </div>
      {doctor && (
        <ul className="ops-doctor">
          {doctor.items.map((i) => (
            <li key={i.id || i.title}>
              <span className={`badge flush ${i.level === "ok" ? "good" : i.level === "warn" ? "warn" : "bad"}`}>{LEVEL[i.level]}</span> <strong>{i.title}</strong>
              {i.detail && <div className="small muted">{i.detail}</div>}
              {i.hint && i.level !== "ok" && <div className="small">{i.hint}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
