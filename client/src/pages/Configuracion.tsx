import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Settings, Upload, Calendar, Loader2, FileSpreadsheet, Trash2, AlertCircle, FileText, Plus, Pencil, Sparkles } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";

export default function Configuracion() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return (
      <DashboardLayout>
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
          <h2 className="text-lg font-medium mb-2">Acceso Restringido</h2>
          <p className="text-muted-foreground">Solo los administradores pueden acceder a esta sección.</p>
        </div>
      </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#42302E]">Configuración</h1>
        <p className="text-muted-foreground mt-1">Administración del sistema y calendario DIAN</p>
      </div>

      <Tabs defaultValue="dian">
        <TabsList>
          <TabsTrigger value="dian" className="gap-2">
            <Calendar className="h-4 w-4" /> Calendario DIAN
          </TabsTrigger>
          <TabsTrigger value="obligaciones" className="gap-2">
            <FileText className="h-4 w-4" /> Obligaciones Tributarias
          </TabsTrigger>
          <TabsTrigger value="general" className="gap-2">
            <Settings className="h-4 w-4" /> General
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dian" className="mt-4">
          <DianCalendarSection />
        </TabsContent>

        <TabsContent value="obligaciones" className="mt-4">
          <TaxObligationsSection />
        </TabsContent>

        <TabsContent value="general" className="mt-4">
          <GeneralSettingsSection />
        </TabsContent>
      </Tabs>
    </div>
    </DashboardLayout>
  );
}

function DianCalendarSection() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [filterObligation, setFilterObligation] = useState("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [parsedEntries, setParsedEntries] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const { data: entries, isLoading, refetch } = trpc.dianCalendar.getEntries.useQuery({
    year: parseInt(selectedYear),
    obligationCode: filterObligation !== "all" ? filterObligation : undefined,
  });

  const { data: obligations } = trpc.obligations.list.useQuery();
  const uploadCalendar = trpc.dianCalendar.upload.useMutation();
  const copyEntries = trpc.dianCalendar.copyFromObligation.useMutation();
  const [copyFromCode, setCopyFromCode] = useState("");
  const [copyToCode, setCopyToCode] = useState("");

  const handleCopyEntries = async () => {
    try {
      const result = await copyEntries.mutateAsync({
        year: parseInt(selectedYear),
        fromObligationCode: copyFromCode,
        toObligationCode: copyToCode,
      });
      if (result.count === 0) {
        toast.error(`No hay fechas cargadas para ${copyFromCode} en ${selectedYear}. Cargue primero su calendario.`);
        return;
      }
      toast.success(`${result.count} fechas copiadas a ${copyToCode} correctamente.`);
      setCopyFromCode("");
      setCopyToCode("");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al copiar el calendario");
    }
  };
  const uploadPdf = trpc.dianCalendar.uploadPdf.useMutation();
  const startExtraction = trpc.dianCalendar.startExtraction.useMutation();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [isExtractingPdf, setIsExtractingPdf] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Poll the background extraction job every few seconds instead of waiting
  // on a single long HTTP request, which would time out for a calendar this
  // large (one AI call per obligation, several minutes total).
  const { data: jobStatus } = trpc.dianCalendar.getExtractionStatus.useQuery(
    { jobId: activeJobId ?? "" },
    {
      enabled: !!activeJobId,
      refetchInterval: (query) => (query.state.data?.status === "processing" ? 4000 : false),
    }
  );

  useEffect(() => {
    if (!jobStatus || jobStatus.status === "processing") return;

    setIsExtractingPdf(false);
    setActiveJobId(null);
    if (pdfInputRef.current) pdfInputRef.current.value = "";

    if (jobStatus.status === "failed" || jobStatus.status === "not_found") {
      toast.error(jobStatus.error || "Error al procesar el PDF");
      return;
    }

    const result = jobStatus.result;
    if (!result) return;

    if (result.error) {
      toast.error(result.error);
      return;
    }

    if (result.entries.length === 0) {
      toast.error("No se encontraron registros en el PDF. Intente con el formato CSV o revise el archivo.");
      return;
    }

    setParsedEntries(result.entries);
    setShowPreview(true);
    toast.success(`${result.entries.length} registros extraídos con IA. Revise la vista previa antes de guardar.`);

    if (result.failedObligations && result.failedObligations.length > 0) {
      toast.warning(`No se pudo leer del PDF: ${result.failedObligations.join(", ")}. Revise esas obligaciones manualmente o cárguelas por CSV.`);
    }

    if (result.partialObligations && result.partialObligations.length > 0) {
      toast.warning(`Atención: ${result.partialObligations.join(", ")} se leyó de forma incompleta (la respuesta de la IA se cortó). Revise esos registros con cuidado en la vista previa antes de guardar.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatus]);

  const handlePdfSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      toast.error("Solo se aceptan archivos PDF");
      return;
    }

    setIsExtractingPdf(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const uploadResult = await uploadPdf.mutateAsync({
        fileName: file.name,
        fileBase64: base64,
        contentType: file.type,
      });

      const { jobId } = await startExtraction.mutateAsync({
        fileKey: uploadResult.key,
        year: parseInt(selectedYear),
      });

      toast.info("Leyendo el calendario con IA, obligación por obligación. Esto puede tardar varios minutos — puede navegar a otra pestaña, el proceso sigue en el servidor.");
      setActiveJobId(jobId);
      // Note: isExtractingPdf stays true and the file input isn't reset yet —
      // both get cleared by the polling effect once the job actually finishes.
    } catch (error: any) {
      toast.error(error.message || "Error al procesar el PDF");
      setIsExtractingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "txt"].includes(ext || "")) {
      toast.error("Solo se aceptan archivos CSV o TXT con formato de calendario DIAN");
      return;
    }

    setIsUploading(true);
    try {
      const text = await file.text();
      const lines = text.split("\n").filter(l => l.trim());
      
      // Expected CSV format: obligationCode,period,lastDigitNit,dueDate
      // Skip header if present
      const startIdx = lines[0].toLowerCase().includes("obligat") || lines[0].toLowerCase().includes("codigo") ? 1 : 0;
      
      const parsed: any[] = [];
      for (let i = startIdx; i < lines.length; i++) {
        const parts = lines[i].split(/[,;\t]/).map(p => p.trim().replace(/"/g, ""));
        if (parts.length >= 4) {
          parsed.push({
            obligationCode: parts[0],
            period: parts[1],
            lastDigitNit: parts[2],
            dueDate: parts[3],
          });
        }
      }

      if (parsed.length === 0) {
        toast.error("No se encontraron registros válidos en el archivo. Formato esperado: código_obligación, periodo, último_dígito_NIT, fecha_vencimiento");
        return;
      }

      setParsedEntries(parsed);
      setShowPreview(true);
      toast.success(`${parsed.length} registros encontrados. Revise la vista previa.`);
    } catch (error) {
      toast.error("Error al leer el archivo");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleConfirmUpload = async () => {
    try {
      const result = await uploadCalendar.mutateAsync({
        year: parseInt(selectedYear),
        entries: parsedEntries,
        clearExisting: true,
      });
      toast.success(`Calendario DIAN actualizado: ${result.count} registros cargados`);
      setParsedEntries([]);
      setShowPreview(false);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al cargar el calendario");
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Section */}
      <Card className="border-[#EDA011]/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Cargar Calendario DIAN
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2 max-w-xs">
              <Label>Año del calendario</Label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 border rounded-lg p-3">
                <Label className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#EDA011]" />
                  PDF oficial de la DIAN (con IA)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Suba el PDF del calendario tributario tal como lo publica la DIAN. La IA extrae las fechas automáticamente.
                </p>
                <Button
                  variant="outline"
                  className="gap-2 w-full"
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={isExtractingPdf}
                >
                  {isExtractingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {isExtractingPdf ? "Leyendo con IA..." : "Subir PDF del calendario"}
                </Button>
                {isExtractingPdf && jobStatus?.progress && jobStatus.progress.total > 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    Procesando {jobStatus.progress.current} de {jobStatus.progress.total}: {jobStatus.progress.currentObligation}
                  </p>
                )}
                <input
                  ref={pdfInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf"
                  onChange={handlePdfSelect}
                />
              </div>

              <div className="space-y-2 border rounded-lg p-3">
                <Label className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  Archivo CSV (manual)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Si prefiere transcribir el calendario usted mismo, o para corregir un archivo ya preparado.
                </p>
                <Button
                  variant="outline"
                  className="gap-2 w-full"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  Seleccionar archivo CSV
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".csv,.txt"
                  onChange={handleFileSelect}
                />
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-3 text-sm">
              <p className="font-medium mb-1">Formato esperado del archivo CSV:</p>
              <code className="text-xs bg-background px-2 py-1 rounded block">
                codigo_obligacion, periodo, ultimo_digito_nit, fecha_vencimiento (YYYY-MM-DD)
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                Ejemplo: IVA_BIM, 2025-01-02, 1, 2025-03-10
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Separadores aceptados: coma, punto y coma, o tabulación.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {'\u26a0'} Ya sea que use el PDF con IA o el CSV manual, siempre podrá revisar y corregir los registros antes de guardarlos.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview of parsed entries */}
      {showPreview && parsedEntries.length > 0 && (
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base text-green-800">
                Vista Previa ({parsedEntries.length} registros)
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowPreview(false); setParsedEntries([]); }}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Descartar
                </Button>
                <Button size="sm" onClick={handleConfirmUpload} disabled={uploadCalendar.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
                  {uploadCalendar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                  Confirmar Carga
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Obligación</TableHead>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Último Dígito NIT</TableHead>
                    <TableHead>Fecha Vencimiento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedEntries.slice(0, 20).map((entry, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs">{entry.obligationCode}</TableCell>
                      <TableCell>{entry.period}</TableCell>
                      <TableCell>{entry.lastDigitNit}</TableCell>
                      <TableCell>{entry.dueDate}</TableCell>
                    </TableRow>
                  ))}
                  {parsedEntries.length > 20 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground text-sm">
                        ... y {parsedEntries.length - 20} registros más
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Calendar Entries */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Calendario Cargado - {selectedYear}
            </CardTitle>
            <Select value={filterObligation} onValueChange={setFilterObligation}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtrar por obligación" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las obligaciones</SelectItem>
                {obligations?.map((ob: any) => (
                  <SelectItem key={ob.id} value={ob.code}>{ob.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-muted/40 rounded-lg">
            <div className="space-y-1">
              <Label className="text-xs">Copiar fechas de</Label>
              <Select value={copyFromCode} onValueChange={setCopyFromCode}>
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder="Obligación origen" />
                </SelectTrigger>
                <SelectContent>
                  {obligations?.map((ob: any) => (
                    <SelectItem key={ob.id} value={ob.code}>{ob.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hacia</Label>
              <Select value={copyToCode} onValueChange={setCopyToCode}>
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder="Obligación destino" />
                </SelectTrigger>
                <SelectContent>
                  {obligations?.map((ob: any) => (
                    <SelectItem key={ob.id} value={ob.code}>{ob.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              className="h-9"
              disabled={!copyFromCode || !copyToCode || copyFromCode === copyToCode || copyEntries.isPending}
              onClick={handleCopyEntries}
            >
              {copyEntries.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Copiar fechas
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              Úselo cuando el calendario indique que una obligación comparte exactamente las mismas fechas que otra (ej: Consumo sigue las mismas fechas que IVA Bimestral).
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[#EDA011]" />
            </div>
          ) : entries && entries.length > 0 ? (
            <div className="max-h-[400px] overflow-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Obligación</TableHead>
                    <TableHead>Periodo</TableHead>
                    <TableHead>Último Dígito NIT</TableHead>
                    <TableHead>Fecha Vencimiento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry: any) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">{entry.obligationCode}</Badge>
                      </TableCell>
                      <TableCell>{entry.period}</TableCell>
                      <TableCell className="text-center">{entry.lastDigitNit}</TableCell>
                      <TableCell>{new Date(entry.dueDate).toLocaleDateString("es-CO", { timeZone: "UTC" })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No hay registros del calendario DIAN para {selectedYear}</p>
              <p className="text-sm mt-1">Cargue un archivo CSV con las fechas de vencimiento oficiales.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GeneralSettingsSection() {
  const { data: settings, isLoading, refetch } = trpc.settings.getAll.useQuery();
  const setSetting = trpc.settings.set.useMutation();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleSave = async (key: string) => {
    try {
      await setSetting.mutateAsync({ key, value: editValue });
      toast.success("Configuración actualizada");
      setEditingKey(null);
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al guardar");
    }
  };

  const settingsConfig = [
    { key: "drive_folder_url", label: "URL Carpeta Google Drive", description: "Enlace a la carpeta compartida de documentos" },
    { key: "firm_name", label: "Nombre de la Firma", description: "Nombre que aparece en reportes y notificaciones" },
    { key: "notification_days_before", label: "Días de anticipación para alertas", description: "Cuántos días antes de un vencimiento se genera la alerta" },
    { key: "auto_task_days_before", label: "Días de anticipación para tareas automáticas", description: "Cuántos días antes del vencimiento se crea la tarea automática (por defecto: 10)" },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-[#EDA011]" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Configuración General</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {settingsConfig.map(config => {
            const current = settings?.find((s: any) => s.key === config.key);
            const isEditing = editingKey === config.key;

            return (
              <div key={config.key} className="flex items-center gap-4 p-3 rounded-lg border">
                <div className="flex-1">
                  <p className="font-medium text-sm">{config.label}</p>
                  <p className="text-xs text-muted-foreground">{config.description}</p>
                  {!isEditing && (
                    <p className="text-sm mt-1 font-mono text-[#42302E]">
                      {current?.value || <span className="text-muted-foreground italic">No configurado</span>}
                    </p>
                  )}
                </div>
                {isEditing ? (
                  <div className="flex gap-2 items-center">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-[300px]"
                      autoFocus
                    />
                    <Button size="sm" onClick={() => handleSave(config.key)} disabled={setSetting.isPending} className="bg-[#EDA011] hover:bg-[#d48f0f] text-white">
                      Guardar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingKey(null)}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setEditingKey(config.key); setEditValue(current?.value || ""); }}
                  >
                    Editar
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

const frequencyLabels: Record<string, string> = {
  mensual: "Mensual",
  bimestral: "Bimestral",
  cuatrimestral: "Cuatrimestral",
  semestral: "Semestral",
  anual: "Anual",
};

function TaxObligationsSection() {
  const { data: obligations, isLoading, refetch } = trpc.obligations.listAll.useQuery();
  const createObligation = trpc.obligations.create.useMutation();
  const updateObligation = trpc.obligations.update.useMutation();
  const setActive = trpc.obligations.setActive.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [editingObligation, setEditingObligation] = useState<any>(null);
  const [form, setForm] = useState({ code: "", name: "", description: "", frequency: "mensual", installments: "1", fixedDates: [] as string[] });

  const resetForm = () => {
    setForm({ code: "", name: "", description: "", frequency: "mensual", installments: "1", fixedDates: [] });
    setEditingObligation(null);
  };

  const handleOpenNew = () => { resetForm(); setShowForm(true); };

  const handleEdit = (obligation: any) => {
    let fixedDates: string[] = [];
    if (obligation.fixedDueDates) {
      try {
        fixedDates = JSON.parse(obligation.fixedDueDates);
      } catch {
        fixedDates = [];
      }
    }
    setEditingObligation(obligation);
    setForm({
      code: obligation.code,
      name: obligation.name,
      description: obligation.description || "",
      frequency: obligation.frequency,
      installments: String(obligation.installments || 1),
      fixedDates,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.code || !form.name) {
      toast.error("Código y nombre son obligatorios");
      return;
    }
    try {
      const { fixedDates, ...rest } = form;
      const payload = { ...rest, installments: parseInt(form.installments) || 1, fixedDueDates: fixedDates };
      if (editingObligation) {
        await updateObligation.mutateAsync({ id: editingObligation.id, ...payload });
        toast.success("Obligación actualizada correctamente");
      } else {
        await createObligation.mutateAsync(payload);
        toast.success("Obligación creada correctamente");
      }
      setShowForm(false);
      resetForm();
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Error al guardar la obligación");
    }
  };

  const addFixedDate = () => setForm({ ...form, fixedDates: [...form.fixedDates, "03-31"] });
  const removeFixedDate = (idx: number) => setForm({ ...form, fixedDates: form.fixedDates.filter((_, i) => i !== idx) });
  const updateFixedDate = (idx: number, value: string) => {
    // value comes from <input type="date"> as "YYYY-MM-DD" — keep only MM-DD
    const md = value.slice(5);
    setForm({ ...form, fixedDates: form.fixedDates.map((d, i) => (i === idx ? md : d)) });
  };

  const handleToggleActive = async (obligation: any) => {
    try {
      await setActive.mutateAsync({ id: obligation.id, isActive: !obligation.isActive });
      toast.success(obligation.isActive ? "Obligación desactivada" : "Obligación reactivada");
      refetch();
    } catch {
      toast.error("Error al cambiar el estado de la obligación");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[#EDA011]" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Catálogo de Obligaciones Tributarias
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Estas son las obligaciones que se pueden asignar a cada cliente para generar sus vencimientos
          </p>
        </div>
        <Button onClick={handleOpenNew} className="gap-2 bg-[#EDA011] hover:bg-[#d48f0f] text-white">
          <Plus className="h-4 w-4" /> Nueva Obligación
        </Button>
      </CardHeader>
      <CardContent>
        {obligations && obligations.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Periodicidad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {obligations.map((obligation: any) => (
                <TableRow key={obligation.id}>
                  <TableCell className="font-mono text-sm">{obligation.code}</TableCell>
                  <TableCell className="font-medium">{obligation.name}</TableCell>
                  <TableCell className="text-sm">
                    {frequencyLabels[obligation.frequency]}
                    {obligation.frequency === "anual" && obligation.installments > 1 && (
                      <span className="text-muted-foreground"> ({obligation.installments} cuotas)</span>
                    )}
                    {obligation.fixedDueDates && (
                      <div className="text-xs text-[#EDA011] mt-0.5">
                        Fecha fija: {(() => {
                          try {
                            return (JSON.parse(obligation.fixedDueDates) as string[]).join(", ");
                          } catch {
                            return "";
                          }
                        })()}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={obligation.isActive ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-600"}>
                      {obligation.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(obligation)} title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={obligation.isActive ? "text-red-600" : "text-green-700"}
                        onClick={() => handleToggleActive(obligation)}
                      >
                        {obligation.isActive ? "Desactivar" : "Reactivar"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p>Aún no hay obligaciones tributarias registradas</p>
          </div>
        )}
      </CardContent>

      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingObligation ? "Editar Obligación" : "Nueva Obligación Tributaria"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Código *</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="Ej: IVA, RETEFUENTE, ICA"
              />
              <p className="text-xs text-muted-foreground">
                Debe coincidir con el código usado en el calendario DIAN que se cargue
              </p>
            </div>
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej: Declaración de IVA"
              />
            </div>
            <div className="space-y-2">
              <Label>Periodicidad *</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensual">Mensual</SelectItem>
                  <SelectItem value="bimestral">Bimestral</SelectItem>
                  <SelectItem value="cuatrimestral">Cuatrimestral</SelectItem>
                  <SelectItem value="semestral">Semestral</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.frequency === "anual" && (
              <div className="space-y-2">
                <Label>Número de cuotas</Label>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={form.installments}
                  onChange={(e) => setForm({ ...form, installments: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Use 1 para una sola declaración/pago. Use más de 1 si se paga en varias cuotas dentro del año (ej: Renta Grandes Contribuyentes = 3 cuotas, Personas Jurídicas = 2 cuotas).
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Fecha(s) de vencimiento fija(s)</Label>
              <p className="text-xs text-muted-foreground">
                Use esto solo si la obligación tiene la misma fecha para todos los clientes, sin importar el NIT (ej: renovación de Cámara de Comercio, reportes a Supersalud o Supersociedades). Si el vencimiento depende del NIT, déjelo vacío y cárguelo con la herramienta del Calendario DIAN.
              </p>
              {form.fixedDates.map((md, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={`${new Date().getFullYear()}-${md}`}
                    onChange={(e) => updateFixedDate(idx, e.target.value)}
                    className="flex-1"
                  />
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-red-600" onClick={() => removeFixedDate(idx)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="gap-2" onClick={addFixedDate}>
                <Plus className="h-3.5 w-3.5" /> Agregar fecha
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Notas adicionales sobre esta obligación..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={createObligation.isPending || updateObligation.isPending}
              className="bg-[#EDA011] hover:bg-[#d48f0f] text-white"
            >
              {(createObligation.isPending || updateObligation.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingObligation ? "Actualizar" : "Crear Obligación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
