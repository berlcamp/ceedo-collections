"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { FieldShell } from "@/components/ui/field";
import { Notice, Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import {
  issueCredential,
  revokeCredential,
  type IssueCredentialResult,
} from "@/lib/devices/credential-actions";
import { encodeEnrollment } from "@ceedo/shared";

export interface DeviceOption {
  id: string;
  label: string;
}

/**
 * Admin-only action, gated by the caller (see `[resource]/page.tsx`'s own `isAdmin` check
 * before rendering this at all) -- the server actions check again, but a screen offered to
 * a role that can never use it is its own kind of wrong (`layout.tsx`'s own convention).
 *
 * The issued secret is shown exactly once, in this component's own state, and is never
 * fetched back from anywhere: the server keeps only its SHA-256 digest
 * (`device_credentials.secret_hash`, migration 20260918000026). Re-issuing revokes the
 * device's previous live credential in the same transaction, so choosing a device that
 * already has one is how a lost or replaced tablet is handled, not a separate flow.
 */
export function DeviceCredentialPanel({ devices }: { devices: DeviceOption[] }) {
  const [deviceId, setDeviceId] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [issued, setIssued] = useState<IssueCredentialResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!issued?.credentialId || !issued.secret) {
      setQr(null);
      return;
    }
    // Rendered client-side from state that already holds the secret. It must never be sent
    // anywhere to be turned into an image -- the whole point of `issue_device_credential`
    // returning it once is that it exists in exactly one place for one moment.
    QRCode.toDataURL(encodeEnrollment(issued.credentialId, issued.secret), {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
    }).then(setQr, () => setQr(null));
  }, [issued]);

  async function onIssue() {
    if (!deviceId) return;
    setIssuing(true);
    setError(null);
    const formData = new FormData();
    formData.set("deviceId", deviceId);
    const result = await issueCredential(formData);
    setIssuing(false);
    if (!result.ok) {
      setError(result.formError ?? "Could not issue a credential.");
      setIssued(null);
      return;
    }
    setIssued(result);
  }

  async function onRevoke() {
    if (!deviceId) return;
    setRevoking(true);
    setError(null);
    const formData = new FormData();
    formData.set("deviceId", deviceId);
    const result = await revokeCredential(formData);
    setRevoking(false);
    if (!result.ok) {
      setError(result.formError ?? "Could not revoke the credential.");
      return;
    }
    setIssued(null);
  }

  if (devices.length === 0) return null;

  return (
    <Panel
      title="Device credential"
      note="Issuing a credential for a device that already has one revokes the previous one in the same step -- use this both to set up a new tablet and to replace a lost one."
      className="max-w-xl"
    >
      <FieldShell id="credential-device" label="Device">
        <Select
          id="credential-device"
          value={deviceId}
          onValueChange={(value) => {
            setDeviceId(value);
            setIssued(null);
            setError(null);
          }}
          options={devices.map((device) => ({ value: device.id, label: device.label }))}
        />
      </FieldShell>

      {error ? (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={onIssue}
          disabled={!deviceId || issuing || revoking}
        >
          {issuing ? "Issuing…" : "Issue credential"}
        </Button>
        <Button
          variant="secondary"
          onClick={onRevoke}
          disabled={!deviceId || issuing || revoking}
          className="border-ribbon/45 text-ribbon hover:bg-ribbon-soft"
        >
          {revoking ? "Revoking…" : "Revoke credential"}
        </Button>
      </div>

      {issued ? (
        <div className="mt-4 border border-amber/45 bg-amber-soft p-3">
          <p className="mb-2.5 text-xs font-semibold text-amber">
            This secret is shown once and cannot be recovered. Copy it to the tablet now.
          </p>
          <dl className="space-y-1.5 text-xs text-amber">
            <div>
              <dt className="caption mb-0.5">Credential ID</dt>
              <dd className="break-all font-mono text-ink">{issued.credentialId}</dd>
            </div>
            <div>
              <dt className="caption mb-0.5">Secret</dt>
              <dd className="break-all font-mono text-ink">{issued.secret}</dd>
            </div>
          </dl>
          {qr ? (
            /* eslint-disable-next-line @next/next/no-img-element --
               a data: URI built in this component's own state, which next/image would
               route through the optimizer and, for a one-shot secret, off this page. */
            <img
              src={qr}
              alt="Enrollment QR code"
              width={256}
              height={256}
              className="mt-3 border border-amber/30 bg-white p-2"
            />
          ) : (
            <p className="mt-3 text-xs text-amber">
              QR could not be rendered. Type the credential ID and secret into the tablet
              instead — the values above are complete.
            </p>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
