/** A failed page request with a way forward. */
export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card error" role="alert">
      <p>Tietojen haku epäonnistui. {message}</p>
      <button className="btn" type="button" onClick={onRetry}>
        Yritä uudelleen
      </button>
    </div>
  );
}
