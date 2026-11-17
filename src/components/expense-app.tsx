"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import * as api from "@/lib/api";
import { createDemoExpense, DEMO_STORAGE_KEY, loadDemoExpenses, persistDemoExpenses, setDemoSettlement } from "@/lib/demo";
import { amountInput, blankLine, coupleMembers, currencies, defaultParticipants, localDate, makeExpenseInput, MAX_LINES, money, sampleReceipt, splitItems, toCents, validateImage, type CoupleMemberId, type Currency, type DraftLine, type Expense, type Participant, type Receipt, type SplitMode } from "@/lib/domain";
import { memberName, summarizeLedger, ticketDebt } from "@/lib/ledger";
import { CURRENT_MEMBER_KEY, loadCurrentMember } from "@/lib/preferences";
import { prepareImage } from "@/lib/image-prepare";
import { CropDialog } from "./crop-dialog";
import { Icon } from "./icon";

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const subscribe = () => () => undefined;
type Notice = { kind: "error" | "success" | "info"; message: string };
type Session = { token: string; expiresAt: number };

function readInitialMember(): CoupleMemberId {
  try {
    return loadCurrentMember(window.localStorage);
  } catch {
    return "adela";
  }
}

function readInitialHistory(): { items: Expense[]; error: string | null } {
  if (!IS_DEMO) return { items: [], error: null };
  try {
    return { items: loadDemoExpenses(window.localStorage), error: null };
  } catch {
    return { items: [], error: "No se ha podido leer el historial local. No se ha sobrescrito. Revisa el almacenamiento de tu navegador o borra los datos de la demo para empezar de nuevo." };
  }
}

export function ExpenseApp() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return mounted ? <App /> : <main className="boot" role="status"><span className="brand-mark" />Preparando A medias…</main>;
}

function App() {
  const [initialHistory] = useState(readInitialHistory);
  const [expenses, setExpenses] = useState<Expense[]>(initialHistory.items);
  const [historyReady, setHistoryReady] = useState(IS_DEMO && !initialHistory.error);
  const [notice, setNotice] = useState<Notice | null>(initialHistory.error ? { kind: "error", message: initialHistory.error } : null);
  const [tab, setTab] = useState<"new" | "history">("new");
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(localDate);
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [lines, setLines] = useState<DraftLine[]>(() => [blankLine()]);
  const [participants, setParticipants] = useState<Participant[]>(defaultParticipants);
  const [registeredById, setRegisteredById] = useState<CoupleMemberId>(readInitialMember);
  const [paidById, setPaidById] = useState<CoupleMemberId>(registeredById);
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [receiptTotal, setReceiptTotal] = useState<number | null>(null);
  const [receiptWarnings, setReceiptWarnings] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const previewRef = useRef("");
  const [cropSource, setCropSource] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const saveAttempt = useRef<{ serialized: string; key: string } | null>(null);
  const unlocked = IS_DEMO || session !== null;
  const locked = !unlocked || Boolean(busy);
  const hasDraft = Boolean(merchant.trim() || lines.some((line) => line.name.trim() || line.amount.trim()));
  const selectedCount = lines.filter((line) => line.selected && (line.name.trim() || line.amount.trim())).length;
  const allSelected = lines.length > 0 && lines.every((line) => line.selected);
  const parsed = lines.map((line) => ({ ...line, cents: toCents(line.amount) }));
  const selectedTotal = parsed.filter((line) => line.selected).reduce((total, line) => total + (line.cents ?? 0), 0);
  const sharedTotal = parsed.filter((line) => line.selected && line.ownerId == null).reduce((total, line) => total + (line.cents ?? 0), 0);
  const personalTotal = selectedTotal - sharedTotal;
  const receiptSum = parsed.reduce((total, line) => total + (line.cents ?? 0), 0);
  const hasInvalidAmounts = parsed.some((line) => (line.name.trim() || line.amount.trim()) && line.cents === null);
  const weightsValid = splitMode === "equal" || participants.every((person) => Number.isInteger(person.weight) && person.weight >= 1 && person.weight <= 10_000);
  const shares = selectedTotal >= 0 && weightsValid && !hasInvalidAmounts ? splitItems(parsed.map((line) => ({ ...line, amountCents: line.cents ?? 0 })), participants, splitMode) : [];
  const hasNegativeShares = shares.some((share) => share.amountCents < 0);

  const endSession = useCallback(() => {
    tokenRef.current = null;
    saveAttempt.current = null;
    setSession(null);
    setExpenses([]);
    setHistoryReady(false);
    setMerchant("");
    setDate(localDate());
    setCurrency("EUR");
    setLines([blankLine()]);
    setParticipants(defaultParticipants());
    const remembered = readInitialMember();
    setRegisteredById(remembered);
    setPaidById(remembered);
    setSplitMode("equal");
    setReceiptTotal(null);
    setReceiptWarnings([]);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreview("");
    setFile(null);
    setCropSource(null);
    setNotice(null);
  }, []);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  useEffect(() => {
    if (!hasDraft && !file) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasDraft, file]);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      endSession();
      setNotice({ kind: "info", message: "Tu sesión ha caducado. El borrador y la foto se han retirado de esta pestaña por privacidad. Vuelve a iniciar sesión." });
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session, endSession]);

  function reportError(error: unknown) {
    if (error instanceof api.ApiError && error.status === 401) {
      endSession();
    }
    setNotice({ kind: "error", message: error instanceof Error ? error.message : "No se pudo completar la operación." });
  }

  async function runTask(label: string, task: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setNotice(null);
    try {
      await task();
    } catch (error) {
      reportError(error);
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function login(email: string, password: string) {
    await runTask("Iniciando sesión", async () => {
      const response = await api.login(email, password);
      tokenRef.current = response.accessToken;
      setSession({ token: response.accessToken, expiresAt: Date.now() + response.expiresIn * 1000 });
      const history = await api.listExpenses(response.accessToken);
      if (tokenRef.current !== response.accessToken) return;
      setExpenses(history.items);
      setHistoryReady(true);
      setNotice({ kind: "success", message: "Sesión iniciada. Ya puedes revisar y guardar tus gastos." });
    });
  }

  function clearPhoto() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreview("");
    setFile(null);
  }

  function resetDraft() {
    setMerchant("");
    setDate(localDate());
    setLines([blankLine()]);
    setPaidById(registeredById);
    setReceiptTotal(null);
    setReceiptWarnings([]);
    saveAttempt.current = null;
    clearPhoto();
  }

  function logout() {
    if ((hasDraft || file) && !window.confirm("Cerrar sesión borrará el borrador y la foto de esta pestaña. ¿Continuar?")) return;
    endSession();
  }

  // Convierte (HEIC→JPEG), reduce de tamaño y abre el editor de recorte.
  async function chooseFile(nextFile?: File) {
    if (!nextFile || locked || preparing) return;
    setPreparing(true);
    setNotice({ kind: "info", message: "Preparando la foto…" });
    try {
      const prepared = await prepareImage(nextFile);
      setCropSource(prepared);
      setNotice(null);
    } catch (error) {
      reportError(error);
    } finally {
      setPreparing(false);
    }
  }

  // Foto ya convertida y recortada: la validamos y la dejamos lista para analizar.
  function acceptPhoto(finalFile: File) {
    setCropSource(null);
    try {
      validateImage(finalFile);
      const nextPreview = URL.createObjectURL(finalFile);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = nextPreview;
      setPreview(nextPreview);
      setFile(finalFile);
      setNotice(null);
    } catch (error) {
      reportError(error);
    }
  }

  function applyReceipt(receipt: Receipt) {
    setMerchant(receipt.merchant);
    setDate(receipt.date);
    setCurrency(receipt.currency);
    setLines(receipt.items.map((item) => ({ id: crypto.randomUUID(), name: item.name, amount: amountInput(item.amountCents), selected: true, ownerId: null })));
    setReceiptTotal(receipt.totalCents);
    setReceiptWarnings(receipt.warnings);
    saveAttempt.current = null;
  }

  function loadExample() {
    if (hasDraft && !window.confirm("El ticket de ejemplo sustituirá los productos del borrador. ¿Continuar?")) return;
    clearPhoto();
    applyReceipt(sampleReceipt());
    setNotice({ kind: "info", message: "Ticket de ejemplo cargado. Son datos ficticios, no una lectura de tu foto." });
  }

  async function analyze() {
    if (!file || !session || IS_DEMO) return;
    if (hasDraft && !window.confirm("La lectura sustituirá los productos del borrador. ¿Continuar?")) return;
    const token = session.token;
    await runTask("Interpretando ticket", async () => {
      const receipt = await api.analyzeReceipt(file, token);
      if (tokenRef.current !== token) return;
      applyReceipt(receipt);
      setNotice({ kind: "success", message: "Ticket interpretado. Comprueba los productos, los descuentos y los importes antes de guardar." });
    });
  }

  async function refreshHistory() {
    await runTask("Cargando historial", async () => {
      if (IS_DEMO) {
        setExpenses(loadDemoExpenses(window.localStorage));
      } else {
        if (!session) throw new api.ApiError("Inicia sesión para cargar tus gastos.", 401);
        const token = session.token;
        const response = await api.listExpenses(token);
        if (tokenRef.current !== token) return;
        setExpenses(response.items);
      }
      setHistoryReady(true);
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlocked || !historyReady) return;
    await runTask("Guardando gasto", async () => {
      const input = makeExpenseInput(merchant, date, currency, lines, participants, splitMode, { registeredById, paidById });
      let saved: Expense;
      if (IS_DEMO) {
        const current = loadDemoExpenses(window.localStorage);
        saved = createDemoExpense(input);
        const updated = [saved, ...current];
        persistDemoExpenses(updated, window.localStorage);
        setExpenses(updated);
      } else {
        if (!session) throw new api.ApiError("Inicia sesión para guardar el gasto.", 401);
        const serialized = JSON.stringify(input);
        if (saveAttempt.current?.serialized !== serialized) saveAttempt.current = { serialized, key: crypto.randomUUID() };
        const token = session.token;
        saved = await api.saveExpense(input, token, saveAttempt.current.key);
        if (tokenRef.current !== token) return;
        setExpenses((previous) => [saved, ...previous.filter((expense) => expense.id !== saved.id)].slice(0, 500));
      }
      resetDraft();
      setTab("history");
      setNotice({ kind: "success", message: IS_DEMO ? "Gasto guardado solo en este navegador. No se ha enviado a ningún servidor." : "Gasto guardado en el backend con su reparto por persona." });
    });
  }

  async function removeExpense(expense: Expense) {
    if (!window.confirm(`¿Eliminar el gasto de ${expense.merchant} por ${money(expense.totalCents, expense.currency)}? Esta acción no se puede deshacer.`)) return;
    await runTask("Eliminando gasto", async () => {
      if (IS_DEMO) {
        const updated = loadDemoExpenses(window.localStorage).filter((item) => item.id !== expense.id);
        persistDemoExpenses(updated, window.localStorage);
        setExpenses(updated);
      } else {
        if (!session) throw new api.ApiError("Inicia sesión para eliminar el gasto.", 401);
        const token = session.token;
        await api.deleteExpense(expense.id, token);
        if (tokenRef.current !== token) return;
        setExpenses((previous) => previous.filter((item) => item.id !== expense.id));
      }
      setNotice({ kind: "success", message: "Gasto eliminado." });
    });
  }

  async function changeSettlement(expense: Expense, settled: boolean) {
    const debt = ticketDebt(expense);
    if (!debt || debt.amountCents === 0) return;
    if (settled && !window.confirm(`¿Confirmas que ${memberName(debt.from)} ya ha compensado ${money(debt.amountCents, expense.currency)} a ${memberName(debt.to)} por este ticket? También puede estar incluido en una compensación de varios tickets. Esto no realiza ningún Bizum.`)) return;
    await runTask("Actualizando liquidación", async () => {
      if (IS_DEMO) {
        const current = loadDemoExpenses(window.localStorage);
        const updated = setDemoSettlement(current, expense.id, settled);
        persistDemoExpenses(updated, window.localStorage);
        setExpenses(updated);
      } else {
        if (!session) throw new api.ApiError("Inicia sesión para actualizar el ticket.", 401);
        const token = session.token;
        const updated = await api.setExpenseSettlement(expense, settled, token);
        if (tokenRef.current !== token) return;
        setExpenses((previous) => previous.map((item) => item.id === updated.id ? updated : item));
      }
      setNotice({ kind: "success", message: settled ? "Ticket liquidado. La deuda se ha recalculado; el gasto real no cambia." : "Ticket pendiente de nuevo. Su importe vuelve a contar en el saldo." });
    });
  }

  function selectRegistrant(id: CoupleMemberId) {
    setRegisteredById(id);
    setPaidById(id);
    try {
      window.localStorage.setItem(CURRENT_MEMBER_KEY, id);
    } catch {
      setNotice({ kind: "info", message: "El nombre se usará en este ticket, pero el navegador no permite recordarlo para la próxima visita." });
    }
  }

  function clearDemoHistory() {
    if (!window.confirm("¿Borrar todos los gastos de la demo en este navegador? Esta acción no se puede deshacer.")) return;
    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
      setExpenses([]);
      setHistoryReady(true);
      setNotice({ kind: "info", message: "Historial local eliminado. El borrador no ha cambiado." });
    } catch {
      setNotice({ kind: "error", message: "El navegador no permite modificar el almacenamiento local." });
    }
  }

  function updateLine(id: string, changes: Partial<DraftLine>) {
    setLines((previous) => previous.map((line) => line.id === id ? { ...line, ...changes } : line));
  }

  function updatePerson(id: string, changes: Partial<Participant>) {
    setParticipants((previous) => previous.map((person) => person.id === id ? { ...person, ...changes } : person));
  }

  function changeSplitMode(mode: SplitMode) {
    setSplitMode(mode);
    if (mode === "equal") setParticipants((previous) => previous.map((person) => ({ ...person, weight: Number.isInteger(person.weight) && person.weight >= 1 && person.weight <= 10_000 ? person.weight : 50 })));
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="A medias, inicio" onClick={() => setTab("new")}><span className="brand-mark" /><span>a medias<span className="brand-dot">.</span></span></Link>
        <div className="header-actions"><span className={`mode-pill ${IS_DEMO ? "demo" : ""}`}><span />{IS_DEMO ? "Modo demo" : "Tu espacio compartido"}</span>{session && <button type="button" className="icon-button" aria-label="Cerrar sesión" onClick={logout} disabled={Boolean(busy)}><Icon name="logout" /></button>}</div>
      </header>

      <main className="main-content">
        <section className="hero">
          <div><p className="eyebrow">MENOS CONTAS. MENOS DISCUSIÓNS. MÁIS VIDA XUNTOS.</p><h1>O compartido,<br /><span>ben repartido.</span></h1><p className="hero-description">Un ticket, un par de checks e cada un coa su parte.<br className="desktop-only" /> Sin calculadora. Sin contas pendentes.</p></div>
          {/* <div className="hero-art" aria-hidden="true"><div className="art-circle" /><div className="mini-receipt"><Icon name="receipt" /><span>EL PLAN DE HOY</span><i /><i /><strong>A medias <span>✓</span></strong><div className="receipt-teeth" /></div><div className="art-badge">50 <small>/</small> 50</div><span className="art-spark">✦</span></div> */}
          <div className="hero-art" aria-hidden="true"><Image src="/hero-art.png" alt="" width={926} height={520} style={{ width: "100%", height: "auto" }} priority /></div>
        </section>

        <div className={`environment-banner ${IS_DEMO ? "" : "api-banner"}`}><Icon name={IS_DEMO ? "receipt" : "lock"} /><p>{IS_DEMO ? <><strong>Estás probando una demo.</strong> El historial se guarda solo en este navegador y la IA no está conectada. Las fotos no se envían.</> : <><strong>Modo API · Spring Boot.</strong> La lectura envía la foto a tu backend; este podrá enviarla al proveedor de IA configurado.</>}</p></div>

        {notice && <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}><p>{notice.message}</p><button type="button" className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}><Icon name="close" /></button></div>}
        {busy && <p className="busy-message" role="status"><span className="spinner" />{busy}… El primer arranque del servidor puede tardar. No cierres esta pestaña.</p>}

        {!unlocked && <LoginPanel onLogin={login} busy={Boolean(busy)} />}

        <div className="workspace-heading"><nav className="view-switch" aria-label="Secciones"><button type="button" aria-pressed={tab === "new"} className={tab === "new" ? "active" : ""} onClick={() => setTab("new")}><Icon name="plus" />Nuevo gasto</button><button type="button" aria-pressed={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><Icon name="history" />Historial<span className="count-badge">{expenses.length}</span></button></nav><span className="workspace-hint"><Icon name="lock" />Vuestros gastos, en orden</span></div>

        {unlocked && !historyReady && <div className="notice info"><p>Carga el historial antes de guardar gastos nuevos.</p><button type="button" className="button small secondary" disabled={Boolean(busy)} onClick={() => void refreshHistory()}>Cargar historial</button></div>}

        {tab === "new" ? <form onSubmit={(event) => void save(event)} className="editor-layout">
          <div className="editor-main">
            <section className="card capture-card"><SectionHeading number="01" title="Empieza con un ticket" subtitle="Haz una foto o añade los productos a mano." /><fieldset disabled={locked} className="field-reset">
              <div className="ticket-identity">
                <label>¿Quién registra el ticket?<select value={registeredById} onChange={(event) => selectRegistrant(event.target.value as CoupleMemberId)}>{coupleMembers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                <label>¿Quién ha pagado la compra?<select value={paidById} onChange={(event) => setPaidById(event.target.value as CoupleMemberId)}>{coupleMembers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                <p className="field-hint">Recordamos quién registra en este navegador. Por defecto también paga; puedes cambiarlo si solo estás subiendo su ticket. Los nombres de la pareja son siempre Adela y Martín.</p>
              </div>
              <div className={`dropzone ${preview ? "with-preview" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void chooseFile(event.dataTransfer.files[0]); }}>
                {preview ? <div className="photo-preview"><Image src={preview} alt="Vista previa del ticket seleccionado" unoptimized width={180} height={170} /><div><strong>{file?.name}</strong><p>Lista para revisar</p><button type="button" className="text-button" onClick={clearPhoto}>Quitar foto</button></div></div> : <><span className="upload-icon"><Icon name="camera" /></span><h3>Tu próxima cuenta, resuelta</h3><p>Una foto nítida, con el ticket completo.</p></>}
                <div className="upload-actions"><button type="button" className="button primary" disabled={preparing} onClick={() => cameraInput.current?.click()}><Icon name="camera" />Tomar foto</button><button type="button" className="button secondary" disabled={preparing} onClick={() => uploadInput.current?.click()}><Icon name="upload" />Subir imagen</button></div>
                <input ref={cameraInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" capture="environment" aria-label="Tomar foto del ticket" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
                <input ref={uploadInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Seleccionar imagen del ticket" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
                <span className="upload-footnote">JPG, PNG, WebP o HEIC (iPhone) · Se convierte y optimiza solo · Máximo 8 MB</span>
              </div>
              <div className="capture-footer">{IS_DEMO ? <><span>¿Quieres ver cómo funciona?</span><button type="button" className="text-button" onClick={loadExample}>Cargar ticket de ejemplo <Icon name="arrow" /></button></> : <><span>Revisa la privacidad del proveedor de IA de tu backend.</span><button type="button" className="button primary small" disabled={!file} onClick={() => void analyze()}>Interpretar con IA <Icon name="arrow" /></button></>}</div>
            </fieldset></section>

            <section className="card"><SectionHeading number="02" title="Cada producto, en su sitio" subtitle="Revisa los importes, incluye productos y elige quién asume cada uno." /><fieldset disabled={locked} className="field-reset">
              <div className="receipt-fields"><label>Comercio<input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="Ej. Supermercado" maxLength={120} required /></label><label>Fecha<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label>Moneda<select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} title="Cambiar moneda no convierte los importes">{currencies.map((code) => <option key={code} value={code}>{code}</option>)}</select></label></div>
              <div className="products-heading"><label className="check-label"><input type="checkbox" checked={allSelected} onChange={(event) => setLines((previous) => previous.map((line) => ({ ...line, selected: event.target.checked })))} />Seleccionar todos</label><span>Importe de la línea</span></div>
              <div className="products-list">{lines.map((line, index) => <div className={`product-row ${!line.selected ? "excluded" : ""}`} key={line.id}>
                <input type="checkbox" checked={line.selected} aria-label={`Incluir producto ${index + 1}`} onChange={(event) => updateLine(line.id, { selected: event.target.checked })} />
                <input className="product-name" aria-label={`Producto ${index + 1}`} placeholder="Nombre del producto" value={line.name} maxLength={120} onChange={(event) => updateLine(line.id, { name: event.target.value })} />
                <div className="amount-field"><input inputMode="decimal" aria-label={`Importe del producto ${index + 1}`} aria-invalid={Boolean(line.amount && toCents(line.amount) === null)} placeholder="0,00" value={line.amount} maxLength={12} onChange={(event) => updateLine(line.id, { amount: event.target.value })} /><span>{currency === "EUR" ? "€" : currency === "USD" ? "$" : "£"}</span></div>
                <button type="button" className="icon-button delete-button" aria-label={`Eliminar producto ${index + 1}`} onClick={() => setLines((previous) => previous.length === 1 ? [blankLine()] : previous.filter((item) => item.id !== line.id))}><Icon name="trash" /></button>
                <label className="line-owner"><span>¿Para quién?</span><select aria-label={`Reparto del producto ${index + 1}`} value={line.ownerId ?? ""} disabled={!line.selected} onChange={(event) => updateLine(line.id, { ownerId: event.target.value || null })}><option value="">Compartido</option>{participants.map((person, personIndex) => <option key={person.id} value={person.id}>Solo {person.name.trim() || `Persona ${personIndex + 1}`}</option>)}</select></label>
              </div>)}</div>
              <div className="products-footer"><button type="button" className="text-button" disabled={lines.length >= MAX_LINES} onClick={() => setLines((previous) => [...previous, blankLine()])}><Icon name="plus" />Añadir producto</button><span>{selectedCount} seleccionado{selectedCount === 1 ? "" : "s"}</span></div>
              <p className="field-hint">Elige «Compartido» o asigna el 100 % a una persona. Desmarcar un producto lo excluye de todas las cuentas. Introduce el importe final de cada línea; los descuentos pueden ser negativos y también se pueden asignar.</p>
              {hasInvalidAmounts && <p className="inline-warning">Completa los importes pendientes. Usa, por ejemplo, 12,34.</p>}
              {receiptTotal !== null && <p className={`receipt-check ${hasInvalidAmounts || receiptSum !== receiptTotal ? "mismatch" : ""}`}><Icon name="receipt" />Total leído: {money(receiptTotal, currency)} · Suma de todas las líneas: {money(receiptSum, currency)}{!hasInvalidAmounts && receiptSum === receiptTotal ? " · Cuadra ✓" : " · Revisa la diferencia"}</p>}
              {receiptWarnings.length > 0 && <ul className="receipt-warnings">{receiptWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
            </fieldset></section>

            <button type="button" className="text-button new-draft-button" style={{
    width: "100%",
    color: "#fff",
    background: "#d92d20",
    border: "1px solid #b42318",
    fontWeight: 700,
    borderRadius: 16,
  }} disabled={locked} onClick={() => { if (!hasDraft || window.confirm("¿Descartar el borrador actual y empezar de nuevo?")) resetDraft(); }}>Limpiar borrador</button>

            <section className="card"><SectionHeading number="03" title="¿Entre quiénes?" subtitle="El reparto se aplica solo a lo compartido; lo individual se suma entero a su propietario." /><fieldset disabled={locked} className="field-reset">
              <div className="split-switch" role="group" aria-label="Tipo de reparto"><button type="button" aria-pressed={splitMode === "equal"} className={splitMode === "equal" ? "active" : ""} onClick={() => changeSplitMode("equal")}>A partes iguales</button><button type="button" aria-pressed={splitMode === "weighted"} className={splitMode === "weighted" ? "active" : ""} onClick={() => changeSplitMode("weighted")}>Proporcional</button></div>
              <div className="participants-list">{participants.map((person, index) => <div className="participant-row" key={person.id}><span className={`avatar avatar-${index % 4}`}>{index + 1}</span><label className="participant-name"><span className="sr-only">Nombre de la persona {index + 1}</span><input aria-label={`Nombre de la persona ${index + 1}`} value={person.name} readOnly /></label>{splitMode === "weighted" && <label className="weight-field">Peso<input type="number" min="1" max="10000" step="1" value={person.weight || ""} aria-label={`Peso de la persona ${index + 1}`} onChange={(event) => updatePerson(person.id, { weight: Number(event.target.value) })} required /></label>}</div>)}</div>
              <p className="field-hint">{splitMode === "weighted" ? "Usa pesos enteros positivos: 60 y 40 reparten un 60 % y un 40 %. Los pesos no tienen que sumar 100." : "Los céntimos sobrantes se asignan por orden de participantes. La suma siempre coincide con el total."}</p>
            </fieldset></section>
          </div>

          <aside className="summary-column">
            <section className="summary-card">
              <div className="summary-top"><span className="eyebrow">VUESTRO REPARTO</span><span className="summary-icon"><Icon name="users" /></span></div>
              <p className="summary-label">Total seleccionado</p><strong className="summary-total" data-testid="selected-total">{money(selectedTotal, currency)}</strong><span className="selected-label">{selectedCount} producto{selectedCount === 1 ? "" : "s"} · {participants.length} personas</span>
              <div className="summary-breakdown"><p><span>Compartido</span><strong data-testid="shared-total">{money(sharedTotal, currency)}</strong></p><p><span>Individual</span><strong data-testid="personal-total">{money(personalTotal, currency)}</strong></p></div>
              <div className="summary-divider" />
              <div className="share-list">{!hasNegativeShares && shares.map((share, index) => <div className="share-row" key={share.participantId}><span className={`avatar avatar-${index % 4}`}>{(share.name || String(index + 1)).slice(0, 1).toLocaleUpperCase("es")}</span><span>{share.name || `Persona ${index + 1}`}</span><strong data-testid={`share-${index}`}>{money(share.amountCents, currency)}</strong></div>)}</div>
              {(!weightsValid || hasInvalidAmounts || selectedTotal < 0) && <p className="inline-warning">Revisa los importes y los pesos para ver un reparto válido.</p>}
              {hasNegativeShares && <p className="inline-warning">Los descuentos dejan a una persona con un importe negativo. Revisa a quién asignas cada descuento.</p>}
              <div className="summary-note"><Icon name="check" /><span>Tu parte compartida + tus productos individuales.</span></div>
              <button type="submit" className="button primary save-button" disabled={locked || !historyReady || selectedTotal <= 0 || hasInvalidAmounts || !weightsValid || hasNegativeShares}>{busy === "Guardando gasto" ? "Guardando…" : "Guardar gasto"}<Icon name="arrow" /></button>
              <p className="summary-footnote">{IS_DEMO ? "Solo en este navegador. No se guarda la foto." : "El backend valida y recalcula antes de guardar."}</p>
            </section>
            <div className="tip-card"><span>✦</span><p><strong>Las pequeñas cuentas, claras.</strong> Compartid lo común y asignad lo personal a su propietario, aunque una sola persona pague toda la compra.</p></div>
          </aside>
        </form> : <HistoryPanel expenses={expenses} disabled={locked || !historyReady} onDelete={removeExpense} onRefresh={refreshHistory} onClearDemo={clearDemoHistory} onSettlement={changeSettlement} />}

        <footer className="site-footer"><span className="brand-mini">a medias.</span><span>Hecho para compartir, no para complicarse.</span>{IS_DEMO && <button type="button" className="text-button" disabled={Boolean(busy)} onClick={clearDemoHistory}>Borrar datos de la demo</button>}</footer>
      </main>
      {cropSource && <CropDialog file={cropSource} onCancel={() => setCropSource(null)} onConfirm={acceptPhoto} />}
    </div>
  );
}

function SectionHeading({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return <div className="section-heading"><span className="step-number">{number}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function LoginPanel({ onLogin, busy }: { onLogin: (email: string, password: string) => Promise<void>; busy: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onLogin(email.trim(), password);
    setPassword("");
  }
  return <section className="card login-panel"><div><span className="login-icon"><Icon name="lock" /></span><h2>Vuestro espacio privado</h2><p>Inicia sesión con una cuenta creada en tu backend. Este frontend no incluye un servidor de usuarios.</p></div><form onSubmit={(event) => void submit(event)}><label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required disabled={busy} /></label><label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={200} required disabled={busy} /></label><button className="button primary" disabled={busy}>Entrar<Icon name="arrow" /></button></form></section>;
}

function HistoryPanel({ expenses, disabled, onDelete, onRefresh, onClearDemo, onSettlement }: { expenses: Expense[]; disabled: boolean; onDelete: (expense: Expense) => Promise<void>; onRefresh: () => Promise<void>; onClearDemo: () => void; onSettlement: (expense: Expense, settled: boolean) => Promise<void> }) {
  const [month, setMonth] = useState(() => localDate().slice(0, 7));
  const [currency, setCurrency] = useState<Currency>("EUR");
  const visible = expenses.filter((expense) => expense.date.startsWith(month) && expense.currency === currency).sort((first, second) => second.date.localeCompare(first.date) || second.createdAt.localeCompare(first.createdAt));
  const monthly = summarizeLedger(visible, currency);
  const balance = summarizeLedger(expenses, currency);
  const debtor = balance.people.find((person) => person.pendingBalanceCents < 0);
  const creditor = balance.people.find((person) => person.pendingBalanceCents > 0);

  function exportHistory() {
    const blob = new Blob([JSON.stringify({ format: "a-medias-expenses-v2", exportedAt: new Date().toISOString(), items: expenses }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `a-medias-gastos-${localDate()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="history-view">
    <div className="history-toolbar"><div><h2>Las cuentas, a la vista</h2><p>Consulta vuestros gastos compartidos e individuales cada mes.</p></div><div className="history-actions"><button type="button" className="button secondary small" disabled={disabled} onClick={() => void onRefresh()}><Icon name="refresh" />Actualizar</button><button type="button" className="button secondary small" disabled={disabled || expenses.length === 0} onClick={exportHistory}><Icon name="download" />Exportar JSON</button></div></div>
    <div className="history-overview card"><div><span className="eyebrow">TOTAL DEL MES</span><strong data-testid="monthly-total">{money(monthly.totalCents, currency)}</strong><p>{visible.length} gasto{visible.length === 1 ? "" : "s"} · Sin mezclar monedas</p><div className="monthly-subtotals"><span>Compartido <b data-testid="monthly-shared">{money(monthly.sharedCents, currency)}</b></span><span>Individual <b data-testid="monthly-personal">{money(monthly.personalCents, currency)}</b></span></div></div><div className="history-filters"><label>Mes<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><label>Moneda<select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>{currencies.map((code) => <option key={code}>{code}</option>)}</select></label></div></div>
    <div className="person-ledgers">{monthly.people.map((person) => <section className="card person-ledger" key={person.id} aria-label={`Gasto mensual de ${person.name}`}>
      <h3>{person.name}</h3><p>Gasto que le corresponde este mes</p><strong data-testid={`spent-${person.id}`}>{money(person.spentCents, currency)}</strong>
      <dl><div><dt>Parte compartida</dt><dd>{money(person.sharedCents, currency)}</dd></div><div><dt>Productos propios</dt><dd>{money(person.personalCents, currency)}</dd></div><div><dt>Pagado en tienda</dt><dd>{money(person.paidCents, currency)}</dd></div></dl>
    </section>)}</div>
    {monthly.unassignedCents > 0 && <p className="inline-warning">Hay {money(monthly.unassignedCents, currency)} de gastos antiguos con otros nombres. No se han asignado automáticamente a Adela o Martín.</p>}
    <section className="card balance-card" aria-label="Saldo pendiente entre Adela y Martín">
      <span className="eyebrow">SALDO PENDIENTE · TODO EL HISTORIAL CARGADO · {currency}</span>
      <h3 data-testid="net-debt">{debtor && creditor ? `${debtor.name} debe ${money(-debtor.pendingBalanceCents, currency)} a ${creditor.name}` : "No hay saldo neto pendiente"}</h3>
      <div className="balance-people">{balance.people.map((person) => <p key={person.id}><span>{person.name}</span><strong data-testid={`pending-${person.id}`}>{person.pendingBalanceCents < 0 ? `Por pagar: ${money(-person.pendingBalanceCents, currency)}` : person.pendingBalanceCents > 0 ? `Por recibir: ${money(person.pendingBalanceCents, currency)}` : "Al día"}</strong></p>)}</div>
      <p className="field-hint">{balance.pendingCount} ticket{balance.pendingCount === 1 ? "" : "s"} sin liquidar. Se compensan las deudas de ambos, incluidos otros meses, sin mezclar monedas. Si liquidáis el saldo neto, marcad todos los tickets incluidos en esa compensación.</p>
      <p className="field-hint">Marcar «Pagado / Bizum hecho» registra una liquidación completa; no envía dinero. Cambia la deuda, nunca el gasto real ni la parte de cada persona.</p>
      {balance.unknownDebtCount > 0 && <p className="inline-warning">{balance.unknownDebtCount} ticket{balance.unknownDebtCount === 1 ? "" : "s"} antiguo{balance.unknownDebtCount === 1 ? "" : "s"} sin pagador o con identidades no reconocidas: sus deudas no se pueden calcular. No se han inventado pagos.</p>}
    </section>
    {visible.length === 0 ? <div className="empty-state card"><span className="upload-icon"><Icon name="receipt" /></span><h3>Todavía no hay gastos para este mes</h3><p>Guarda vuestro primer ticket o elige otro mes y moneda.</p></div> : <div className="expense-list">{visible.map((expense) => {
      const debt = ticketDebt(expense);
      const shared = expense.items.filter((item) => item.selected && item.ownerId == null).reduce((sum, item) => sum + item.amountCents, 0);
      return <article className={`card expense-card ${expense.settledAt ? "settled" : ""}`} key={expense.id}>
      <div className="expense-card-top"><span className="expense-icon"><Icon name="receipt" /></span><div className="expense-title"><h3>{expense.merchant}</h3><p>{new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${expense.date}T12:00:00`))} · {expense.items.filter((item) => item.selected).length} productos incluidos</p></div><strong className="expense-amount">{money(expense.totalCents, expense.currency)}</strong><button type="button" className="icon-button delete-button" disabled={disabled} aria-label={`Eliminar gasto de ${expense.merchant}`} onClick={() => void onDelete(expense)}><Icon name="trash" /></button></div>
      <div className="expense-shares">{expense.shares.map((share) => <span key={share.participantId}>{share.name}<strong>{money(share.amountCents, expense.currency)}</strong></span>)}</div>
      <div className="ticket-subtotals"><span>Compartido: <strong>{money(shared, expense.currency)}</strong></span><span>Individual: <strong>{money(expense.totalCents - shared, expense.currency)}</strong></span></div>
      <p className="ticket-provenance">Registrado por {expense.registeredById ? memberName(expense.registeredById) : "sin registrar"} · Pagó {expense.paidById ? memberName(expense.paidById) : "sin registrar"}</p>
      <div className="ticket-settlement">
        <p>{debt ? debt.amountCents === 0 ? "Sin importe que compensar: quien pagó asume todo este ticket." : <>{memberName(debt.from)} {expense.settledAt ? "ha compensado" : "debe"} <strong>{money(debt.amountCents, expense.currency)}</strong> a {memberName(debt.to)}</> : "Sin pagador conocido o reparto antiguo: no cuenta en el saldo pendiente."}</p>
        <label className="check-label"><input type="checkbox" aria-label={`Liquidar ticket de ${expense.merchant}`} checked={Boolean(expense.settledAt)} disabled={disabled || !debt || debt.amountCents === 0} onChange={(event) => void onSettlement(expense, event.target.checked)} />Pagado / Bizum hecho</label>
        {expense.settledAt && <small>Liquidado el {new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(expense.settledAt))}. Desmarca para volver a pendiente.</small>}
      </div>
      <details><summary>Ver productos y reparto</summary><ul className="saved-products">{expense.items.map((item) => <li className={item.selected ? "" : "not-shared"} key={item.id}><span>{item.selected ? "✓" : "—"} {item.name}<small> · {!item.selected ? "Excluido" : item.ownerId == null ? "Compartido" : `Solo ${expense.participants.find((person) => person.id === item.ownerId)?.name}`}</small></span><strong>{money(item.amountCents, expense.currency)}</strong></li>)}</ul><p className="field-hint">{expense.splitMode === "equal" ? "Los productos compartidos se reparten a partes iguales." : `Solo lo compartido se reparte con estos pesos: ${expense.participants.map((person) => `${person.name} (${person.weight})`).join(", ")}.`} Los productos individuales se suman íntegros a su propietario.</p></details>
    </article>; })}</div>}
    <div className="history-bottom"><p>Hasta 500 últimos gastos. La exportación incluye el historial cargado, no las fotos.</p>{IS_DEMO && <button type="button" className="text-button" onClick={onClearDemo} disabled={disabled}>Vaciar historial local</button>}</div>
  </section>;
}
