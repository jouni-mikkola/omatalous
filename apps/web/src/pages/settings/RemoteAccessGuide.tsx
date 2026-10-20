/** The steps for making Cloudflare's API token, folded away until the admin needs them. */
import { TOKEN_PAGE, TOKEN_PERMISSIONS } from "./remote-access-model.ts";

export function TokenGuide() {
  return (
    <details className="remote-guide">
      <summary>Näin teet API-tunnisteen Cloudflaressa</summary>
      <p className="small">
        Tarvitset Cloudflare-tilin, jolla verkkotunnuksesi on. Verkkotunnuksen pitää olla käytössä Cloudflaressa (tilana Active), ja tilillä pitää olla Zero Trust käytössä (ilmainen Free-taso riittää).
      </p>
      <ol className="setup-steps">
        <li>
          Avaa{" "}
          <a href={TOKEN_PAGE} target="_blank" rel="noopener noreferrer">
            Cloudflaren API-tunnisteiden sivu
          </a>{" "}
          ja kirjaudu sisään. Valitse Create Token ja sitten Custom token.
        </li>
        <li>Anna tunnisteelle nimi, esimerkiksi Omatalous.</li>
        <li>
          Lisää nämä viisi oikeutta (Permissions). Jokainen valitaan valikoista samassa järjestyksessä kuin nimessä.
          <ul>
            {TOKEN_PERMISSIONS.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
        </li>
        <li>Rajaa tunniste tiliin ja verkkotunnukseen, jota käytät etäkäyttöön.</li>
        <li>Luo tunniste ja kopioi se heti. Cloudflare näyttää sen vain kerran.</li>
        <li>Liitä tunniste alla olevaan kenttään ja paina Tallenna tunniste.</li>
      </ol>
    </details>
  );
}
