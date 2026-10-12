import { useState } from "react";
import { navigate } from "../hooks.ts";

/**
 * Shown on every data page while the user has no accounts, so nobody meets a
 * blank chart or a row of zeros that looks like real data.
 */
export function EmptyStart({ onDemo }: { onDemo: () => Promise<void> }) {
  const [demo, setDemo] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const loadDemo = async () => {
    setDemo({ busy: true, error: null });
    try {
      await onDemo();
    } catch (err) {
      setDemo({ busy: false, error: (err as Error).message });
    }
  };
  return (
    <div className="card empty-start">
      <h2>Ei vielä tietoja</h2>
      <p className="muted">Tuo tapahtumat tiedostosta tai yhdistä pankki.</p>
      <div className="empty-options">
        <div>
          <h3>Tuo tiedosto</h3>
          <p className="small muted">Lataa tapahtumat Nordean verkkopankista CSV-tiedostona.</p>
          <button className="btn btn-primary" type="button" onClick={() => navigate("settings", { section: "csv" })}>
            Tuo CSV
          </button>
        </div>
        <div>
          <h3>Yhdistä pankki</h3>
          <p className="small muted">Tapahtumat haetaan automaattisesti pari kertaa päivässä.</p>
          <button className="btn" type="button" onClick={() => navigate("settings", { add: "1" })}>
            Lisää pankkiyhteys
          </button>
        </div>
      </div>
      <p className="small muted">
        Haluatko ensin kokeilla?{" "}
        <button className="link-btn" type="button" onClick={() => void loadDemo()} disabled={demo.busy}>
          {demo.busy ? "Ladataan…" : "Lataa esimerkkitiedot"}
        </button>
      </p>
      {demo.error && <div className="error">{demo.error}</div>}
    </div>
  );
}
