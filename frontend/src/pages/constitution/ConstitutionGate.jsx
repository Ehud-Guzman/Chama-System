export default function ConstitutionGate({ gateError, id, navigate, onSubmitGate, setGateError, setId, setStatus, status }) {
  return (
    <div className="min-h-dvh bg-page px-3 py-8 sm:px-5 sm:py-12">
      <main className="mx-auto w-full max-w-md">
        <div className="rounded-2xl border border-rule bg-surface p-5 shadow-sm sm:p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
            Members only
          </p>
          <h1 className="mt-1 text-xl font-bold sm:text-2xl">
            The group&rsquo;s constitution
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Enter the ID number registered with the chama to read the constitution.
          </p>

          <form onSubmit={onSubmitGate} className="mt-5" noValidate>
            <label htmlFor="constitution-id" className="mb-2 block text-sm font-semibold">
              ID number
            </label>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="constitution-id"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="12345678"
                value={id}
                onChange={(event) => {
                  setId(event.target.value);
                  if (status === "error") {
                    setStatus("locked");
                    setGateError("");
                  }
                }}
                aria-invalid={status === "error"}
                className="amount h-12 w-full rounded-xl border border-rule bg-page px-4 text-base"
              />

              <button
                type="submit"
                disabled={status === "loading"}
                className="min-h-12 shrink-0 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {status === "loading" ? "Opening…" : "Read it"}
              </button>
            </div>

            {status === "error" && gateError && (
              <p className="mt-2 text-sm font-medium text-alert" role="alert">
                {gateError}
              </p>
            )}
          </form>

          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
            className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-primary"
          >
            ← Back
          </button>
        </div>
      </main>
    </div>
  );
}
