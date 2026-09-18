import { useEffect, useRef, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from './Toast';
import { CHAMA_LOGO } from '../../utils/branding';

// The group's identity as the members' page shows it: the name, the logo and the
// two statements — plus the two office-only fields that have nowhere else to live
// (the constitution the office keeps, and the week reconciliation starts from).
// Any admin can update them: they are identity, not security. The cap on the two
// statements matches the one the API enforces, because both travel to every
// visitor in the public overview.
const STATEMENT_MAX = 600;

export default function ChamaSettingsForm() {
  const toast = useToast();
  const [chamaName, setChamaName] = useState('');
  const [vision, setVision] = useState('');
  const [mission, setMission] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [constitution, setConstitution] = useState('');
  const [weeklyTrackingStartDate, setWeeklyTrackingStartDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState('');
  // Null until the status answers, so the note about missing keys never flashes on
  // a server that has them.
  const [uploadsConfigured, setUploadsConfigured] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const logoInputRef = useRef(null);

  useEffect(() => {
    api
      .get('/api/settings')
      .then((res) => {
        setChamaName(res.data.settings.chamaName);
        setVision(res.data.settings.vision || '');
        setMission(res.data.settings.mission || '');
        setLogoUrl(res.data.settings.logoUrl || '');
        setConstitution(res.data.settings.constitution || '');
        setWeeklyTrackingStartDate(
          res.data.settings.weeklyTrackingStartDate
            ? res.data.settings.weeklyTrackingStartDate.slice(0, 10)
            : ''
        );
      })
      .catch(() => {})
      .finally(() => setLoaded(true));

    api
      .get('/api/uploads/status')
      .then((res) => setUploadsConfigured(Boolean(res.data.cloudinaryConfigured)))
      .catch(() => {});
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/api/settings', {
        chamaName,
        vision,
        mission,
        constitution,
        weeklyTrackingStartDate: weeklyTrackingStartDate || null,
      });
      toast('Settings updated');
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // The logo is saved the moment it uploads rather than on Save. By then the image
  // already exists on Cloudinary, so an admin who picks one and closes the tab would
  // otherwise leave the members' page on the placeholder with an orphaned asset
  // behind it. Everything else on this form still saves together.
  async function saveLogo(url, publicId) {
    setBusy(true);
    try {
      await api.patch('/api/settings', { logoUrl: url, logoPublicId: publicId });
      setLogoUrl(url);
      toast(url ? 'Logo updated' : 'Logo removed');
    } catch (err) {
      toast(apiMessage(err, 'Could not save the logo'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onLogoPicked(e) {
    const file = e.target.files?.[0];
    // Reset the input first: it keeps its value after a pick, so choosing the same
    // image twice in a row would not fire a change event.
    e.target.value = '';
    if (!file) return;

    setLogoError('');
    setLogoUploading(true);
    try {
      const payload = new FormData();
      payload.append('file', file);
      const res = await api.post('/api/uploads/chama-logo', payload);
      await saveLogo(res.data.url, res.data.publicId);
    } catch (err) {
      setLogoError(apiMessage(err, 'Could not upload that image'));
    } finally {
      setLogoUploading(false);
    }
  }

  // Clearing the publicId alongside the URL is what tells the server to delete the
  // Cloudinary asset rather than leave it orphaned.
  function removeLogo() {
    setLogoError('');
    saveLogo('', '');
  }

  if (!loaded) return null;

  return (
    <section className="rounded-xl border border-rule bg-surface p-5">
      <h2 className="text-base font-semibold">Chama identity</h2>
      <p className="mt-1 text-xs text-muted">
        What the public members&rsquo; page shows: the name, the logo and the two statements.
      </p>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <input
          type="text"
          required
          value={chamaName}
          onChange={(e) => setChamaName(e.target.value)}
          className="h-12 w-full rounded-xl border border-rule px-4 text-sm"
          aria-label="Chama name"
        />

        {/* The logo, picked through a button rather than the browser's own file
            control — which looks nothing like the rest of this form and is a small
            tap target on a phone. */}
        <div className="border-t border-rule pt-3">
          <p className="text-sm font-medium">
            Logo <span className="font-normal text-muted">(optional)</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            Shown beside the group&rsquo;s name. A square PNG or JPG works best; the page keeps
            its proportions and never crops it.
          </p>

          <div className="mt-2 flex items-center gap-4">
            <img
              src={logoUrl || CHAMA_LOGO}
              alt=""
              className="h-14 w-14 shrink-0 rounded-xl border border-rule object-contain p-1"
            />

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                onChange={onLogoPicked}
                className="hidden"
                aria-label="Group logo"
              />

              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoUploading || busy || uploadsConfigured === false}
                className="min-h-11 text-sm font-medium text-primary disabled:opacity-60"
              >
                {logoUploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Choose logo'}
              </button>

              {logoUrl && (
                <button
                  type="button"
                  onClick={removeLogo}
                  disabled={logoUploading || busy}
                  className="min-h-11 text-sm font-medium text-alert disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          {uploadsConfigured === false && (
            <p className="mt-2 text-xs text-muted">
              Image uploads are not set up on this server yet — add the Cloudinary keys and this
              picker starts working. Until then the page shows the mark that ships with the app.
            </p>
          )}

          {logoError && (
            <p className="mt-2 text-xs font-medium text-alert" role="alert">
              {logoError}
            </p>
          )}
        </div>

        {/* The two statements. Blank is a real answer rather than a way to lose the
            wording: the server prints the published constitution's own Chapter 2
            clause instead. */}
        <div className="border-t border-rule pt-3">
          <label htmlFor="vision" className="text-sm font-medium">
            Vision
          </label>
          <p className="mt-1 text-xs text-muted">
            Printed at the foot of the members&rsquo; page. Leave blank to use the vision in the
            published constitution (Chapter 2).
          </p>
          <textarea
            id="vision"
            rows={3}
            maxLength={STATEMENT_MAX}
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            placeholder="Leave blank for the constitution's own wording"
            className="mt-2 w-full rounded-xl border border-rule px-4 py-3 text-sm"
          />
        </div>

        <div className="border-t border-rule pt-3">
          <label htmlFor="mission" className="text-sm font-medium">
            Mission
          </label>
          <p className="mt-1 text-xs text-muted">
            Printed beside the vision. Leave blank to use the mission in the published
            constitution (Chapter 2).
          </p>
          <textarea
            id="mission"
            rows={3}
            maxLength={STATEMENT_MAX}
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            placeholder="Leave blank for the constitution's own wording"
            className="mt-2 w-full rounded-xl border border-rule px-4 py-3 text-sm"
          />
        </div>

        <div className="border-t border-rule pt-3">
          <label htmlFor="constitution" className="text-sm font-medium">
            Constitution
          </label>
          <p className="mt-1 text-xs text-muted">
            For the chama&rsquo;s own records. The constitution members read is the published
            edition on the members&rsquo; page, not this field.
          </p>
          <textarea
            id="constitution"
            rows={8}
            value={constitution}
            onChange={(e) => setConstitution(e.target.value)}
            placeholder="Paste or write the chama's constitution here…"
            className="mt-2 w-full rounded-xl border border-rule px-4 py-3 text-sm"
          />
        </div>

        <div className="border-t border-rule pt-3">
          <label htmlFor="weeklyTrackingStartDate" className="text-sm font-medium">
            Weekly reconciliation starts from
          </label>
          <p className="mt-1 text-xs text-muted">
            The Reports → Weekly reconciliation view ignores weeks before this date — useful right
            after a bulk paper-ledger import, where earlier weeks only have a cumulative balance,
            not a real per-week breakdown. Leave blank to reconcile from each member's own join
            date.
          </p>
          <input
            id="weeklyTrackingStartDate"
            type="date"
            value={weeklyTrackingStartDate}
            onChange={(e) => setWeeklyTrackingStartDate(e.target.value)}
            className="mt-2 h-12 w-full rounded-xl border border-rule px-4 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>
  );
}
