"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AuditLogViewer from "./AuditLogViewer";
import AuditLogDetail from "../screens/AuditLogDetail";
import type { AuditLogRecord } from "./audit-log-display";

export default function AuditWorkspace({ authToken }: { authToken: string }) {
  const params = useSearchParams();
  const pk = params.get("pk") ?? "";
  const sk = params.get("sk") ?? "";
  const showingDetail = Boolean(pk || sk);
  const [selected, setSelected] = useState<AuditLogRecord | undefined>();
  const listScroll = useRef(0);
  const wasShowingDetail = useRef(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (showingDetail) container.current?.scrollIntoView({ block: "start" });
      else if (wasShowingDetail.current) window.scrollTo(0, listScroll.current);
      wasShowingDetail.current = showingDetail;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showingDetail]);

  function openDetail(record: AuditLogRecord) {
    listScroll.current = window.scrollY;
    setSelected(record);
    const query = new URLSearchParams({ tab: "audit", pk: record.PK, sk: record.SK });
    // Native history integrates with Next search params without replacing the Admin page.
    window.history.pushState({ auditDetailOpened: true }, "", `/admin?${query}`);
  }

  function backToList() {
    if (window.history.state?.auditDetailOpened) window.history.back();
    else window.history.replaceState(null, "", "/admin?tab=audit");
  }

  const initialRecord = selected?.PK === pk && selected.SK === sk ? selected : undefined;
  return <div ref={container}>
    <div hidden={showingDetail}>
      <AuditLogViewer authToken={authToken} onSelect={openDetail} />
    </div>
    {showingDetail ? <AuditLogDetail key={`${pk}:${sk}`} authToken={authToken} pk={pk} sk={sk} initialRecord={initialRecord} onBack={backToList} /> : null}
  </div>;
}
