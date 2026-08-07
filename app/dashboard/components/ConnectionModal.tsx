import { useState, type FormEvent } from "react";
import { dashboardConnectionSchema, validateForm } from "../../../vercel/validation";
import { Modal } from "./Modal";

export function ConnectionModal({ apiBase, adminToken, onSave, onClose }: { apiBase: string; adminToken: string; onSave: (api: string, token: string) => void; onClose: () => void }) {
  const [api, setApi] = useState(apiBase);
  const [token, setToken] = useState(adminToken);
  const [fieldError, setFieldError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateForm(dashboardConnectionSchema, { apiBase: api, adminToken: token });
    if (!result.ok) { setFieldError(result.message); return; }
    setFieldError("");
    onSave(result.value.apiBase, result.value.adminToken ?? "");
  }

  return (
    <Modal title="Dashboard connection" description="Point this browser at a local or remotely exposed management API." onClose={onClose}>
      <form className="ob-form-stack" onSubmit={submit}>
        <label><span>Management API URL</span><input type="url" value={api} onChange={(event) => setApi(event.target.value)} required placeholder="http://127.0.0.1:7272" autoFocus /></label>
        <label><span>Admin token <small>(session only)</small></span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" placeholder="Required for CLI-managed daemons" /></label>
        {fieldError ? <p className="ob-form-error">{fieldError}</p> : null}
        <p className="ob-form-help">The URL is saved on this device. A token is isolated to that API URL and kept only in this browser tab session.</p>
        <div className="ob-modal-actions">
          <button className="ob-button secondary compact" type="button" onClick={onClose}>Cancel</button>
          <button className="ob-button primary compact" type="submit">Save and connect</button>
        </div>
      </form>
    </Modal>
  );
}
